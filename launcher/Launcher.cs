// Study Buddy launcher: shows a splash, installs updates from GitHub, then opens the app.
// Built by build-launcher.ps1 with the C# compiler that ships with Windows (C# 5, .NET Framework 4.x).
//
// Folder layout it expects next to "Study Buddy.exe":
//   app\index.html, app\css, app\js, app\version.json, app\update.json   (installed copy: updates on)
// or, as a fallback, index.html in the same folder                          (developer copy: updates off)
//
// Flags: --test      no splash, no browser, no prompts; just update and write launcher.log (exit code 1 on error)
//        --no-open   show the splash and update, but do not open the app

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace StudyBuddyLauncher
{
    class UpdateResult
    {
        public bool Updated;
        public bool LauncherUpdated;
        public string NewVersion = "";
        public string Error = "";
    }

    static class Program
    {
        // Files and folders that make up the app. Only these are copied out of an update download.
        static readonly string[] AppItems = { "index.html", "css", "js", "version.json", "update.json", "README.md" };

        static string baseDir, appDir, logPath;
        static bool devMode, testMode, noOpen;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static int Main(string[] args)
        {
            testMode = Array.IndexOf(args, "--test") >= 0;
            noOpen = testMode || Array.IndexOf(args, "--no-open") >= 0;
            baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            logPath = Path.Combine(baseDir, "launcher.log");
            try { File.WriteAllText(logPath, ""); } catch { }
            Log("Study Buddy launcher " + Build.Version + " in " + baseDir);

            try { if (Environment.OSVersion.Version.Major >= 6) SetProcessDPIAware(); } catch { }
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2 for GitHub
            CleanupOldExe();

            appDir = Path.Combine(baseDir, "app");
            if (!File.Exists(Path.Combine(appDir, "index.html")))
            {
                if (File.Exists(Path.Combine(baseDir, "index.html"))) { appDir = baseDir; devMode = true; Log("Developer copy: updates are off."); }
                else
                {
                    Fail("Study Buddy's files are missing. Keep \"Study Buddy.exe\" next to its \"app\" folder, or download Study Buddy again.");
                    return 1;
                }
            }

            string localVersion = ReadString(Path.Combine(appDir, "version.json"), "version");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            UpdateResult result = new UpdateResult();
            Splash splash = testMode ? null : new Splash(localVersion);
            DateTime started = DateTime.Now;
            Thread worker = new Thread(delegate ()
            {
                if (!devMode) result = CheckAndUpdate(delegate (string s) { if (splash != null) splash.SetStatus(s); });
                if (splash != null)
                {
                    if (result.Updated) splash.SetStatus("Updated to version " + result.NewVersion + ".");
                    // Keep the splash up long enough to read, without slowing anyone down.
                    int left = (result.Updated ? 1400 : 700) - (int)(DateTime.Now - started).TotalMilliseconds;
                    if (left > 0) Thread.Sleep(left);
                    splash.BeginInvoke(new Action(splash.Close));
                }
            });
            worker.IsBackground = true;

            if (splash != null) { splash.Shown += delegate { worker.Start(); }; Application.Run(splash); }
            else { worker.Start(); worker.Join(); }

            if (result.Error != "") Log("Update skipped: " + result.Error);
            if (testMode) return result.Error == "" ? 0 : 1;

            if (!noOpen)
            {
                OfferDesktopShortcut();
                OpenApp(result);
            }
            return 0;
        }

        // ---------- updating ----------

        static UpdateResult CheckAndUpdate(Action<string> status)
        {
            UpdateResult r = new UpdateResult();
            string tmp = null;
            try
            {
                Dictionary<string, object> local = ReadJson(Path.Combine(appDir, "version.json"));
                Dictionary<string, object> cfg = ReadJson(Path.Combine(appDir, "update.json"));
                string versionUrl = Str(cfg, "versionUrl"), zipUrl = Str(cfg, "zipUrl");
                string repo = Str(cfg, "repo"), branch = Str(cfg, "branch");
                if (branch == "") branch = "main";
                if (versionUrl == "" && repo != "")
                {
                    versionUrl = "https://raw.githubusercontent.com/" + repo + "/" + branch + "/version.json";
                    zipUrl = "https://github.com/" + repo + "/archive/refs/heads/" + branch + ".zip";
                }
                if (versionUrl == "" || zipUrl == "") { Log("No update source set in update.json."); return r; }

                status("Checking for updates...");
                string sep = versionUrl.Contains("?") ? "&" : "?";
                Dictionary<string, object> remote = Json.Deserialize<Dictionary<string, object>>(DownloadString(versionUrl + sep + "t=" + DateTime.UtcNow.Ticks));
                Version have = ParseVer(Str(local, "version")), want = ParseVer(Str(remote, "version"));
                Log("Installed " + have + ", available " + want);
                if (want <= have) { status("Study Buddy is up to date."); return r; }

                string newVersion = Str(remote, "version");
                status("Downloading version " + newVersion + "...");
                tmp = Path.Combine(Path.GetTempPath(), "study-buddy-update-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(tmp);
                string zipPath = Path.Combine(tmp, "update.zip");
                using (WebClient wc = NewClient()) wc.DownloadFile(zipUrl, zipPath);

                status("Installing version " + newVersion + "...");
                string extracted = Path.Combine(tmp, "files");
                ZipFile.ExtractToDirectory(zipPath, extracted);
                string root = FindAppRoot(extracted, 3);
                if (root == null) throw new Exception("the download did not contain Study Buddy");

                // Stage the new app next to the old one, then swap folders so a failure never leaves a half-installed app.
                string staged = appDir + ".new", old = appDir + ".old";
                DeleteDir(staged); DeleteDir(old);
                Directory.CreateDirectory(staged);
                foreach (string item in AppItems)
                {
                    string src = Path.Combine(root, item), dst = Path.Combine(staged, item);
                    if (Directory.Exists(src)) CopyDir(src, dst);
                    else if (File.Exists(src)) File.Copy(src, dst, true);
                }
                // Never lose the update address: keep the current update.json if the new one has none.
                Dictionary<string, object> newCfg = ReadJson(Path.Combine(staged, "update.json"));
                if (Str(newCfg, "repo") == "" && Str(newCfg, "versionUrl") == "")
                    File.Copy(Path.Combine(appDir, "update.json"), Path.Combine(staged, "update.json"), true);
                if (!File.Exists(Path.Combine(staged, "index.html")) || !Directory.Exists(Path.Combine(staged, "js")))
                    throw new Exception("the downloaded app is incomplete");

                Directory.Move(appDir, old);
                try { Directory.Move(staged, appDir); }
                catch { Directory.Move(old, appDir); throw; }
                DeleteDir(old);
                r.Updated = true;
                r.NewVersion = newVersion;
                Log("Installed version " + newVersion);

                // A newer launcher ships as launcher\Study Buddy.exe. A running exe can be renamed but not overwritten.
                string newExe = Path.Combine(Path.Combine(root, "launcher"), "Study Buddy.exe");
                if (File.Exists(newExe) && ParseVer(Str(remote, "launcher")) > ParseVer(Build.Version))
                {
                    string me = Application.ExecutablePath, bak = me + ".old";
                    if (File.Exists(bak)) File.Delete(bak);
                    File.Move(me, bak);
                    try { File.Copy(newExe, me); r.LauncherUpdated = true; Log("Launcher updated to " + Str(remote, "launcher")); }
                    catch { File.Move(bak, me); throw; }
                }
            }
            catch (WebException e) { r.Error = "could not reach the update server (" + e.Message + ")"; status("Offline. Opening your current version."); }
            catch (Exception e) { r.Error = e.Message; status("Update failed. Opening your current version."); }
            finally { if (tmp != null) DeleteDir(tmp); }
            return r;
        }

        static string FindAppRoot(string dir, int depth)
        {
            if (File.Exists(Path.Combine(dir, "index.html")) && Directory.Exists(Path.Combine(dir, "js"))) return dir;
            if (depth == 0) return null;
            foreach (string sub in Directory.GetDirectories(dir))
            {
                string found = FindAppRoot(sub, depth - 1);
                if (found != null) return found;
            }
            return null;
        }

        static WebClient NewClient()
        {
            WebClient wc = new WebClient();
            wc.Headers[HttpRequestHeader.UserAgent] = "StudyBuddyLauncher/" + Build.Version;
            wc.Headers[HttpRequestHeader.CacheControl] = "no-cache";
            return wc;
        }

        static string DownloadString(string url)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 8000; req.ReadWriteTimeout = 8000;
            req.UserAgent = "StudyBuddyLauncher/" + Build.Version;
            req.Headers[HttpRequestHeader.CacheControl] = "no-cache";
            using (WebResponse res = req.GetResponse())
            using (StreamReader sr = new StreamReader(res.GetResponseStream())) return sr.ReadToEnd();
        }

        // ---------- opening the app ----------

        static void OpenApp(UpdateResult result)
        {
            string url = new Uri(Path.Combine(appDir, "index.html")).AbsoluteUri;
            if (result.Updated) url += "#/updated/" + result.NewVersion;
            string edge = FindEdge();
            try
            {
                if (edge != null)
                {
                    // Edge "app mode": its own window and taskbar entry, no tabs or address bar.
                    Process.Start(new ProcessStartInfo(edge, "--app=\"" + url + "\"") { UseShellExecute = false });
                    Log("Opened in Edge app window");
                    return;
                }
            }
            catch (Exception e) { Log("Edge failed: " + e.Message); }
            Process.Start(new ProcessStartInfo(Path.Combine(appDir, "index.html")) { UseShellExecute = true });
            Log("Opened in default browser");
        }

        static string FindEdge()
        {
            List<string> candidates = new List<string>();
            try
            {
                using (Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                    if (k != null && k.GetValue("") != null) candidates.Add(k.GetValue("").ToString());
            }
            catch { }
            candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"));
            candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"));
            candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"));
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        // ---------- desktop shortcut (asked once) ----------

        static void OfferDesktopShortcut()
        {
            string settingsPath = Path.Combine(baseDir, "launcher-settings.json");
            Dictionary<string, object> settings = ReadJson(settingsPath);
            if (Str(settings, "shortcutAsked") == "True") return;
            string lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Study Buddy.lnk");
            if (!File.Exists(lnk) && !baseDir.StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase))
            {
                DialogResult answer = MessageBox.Show("Add a Study Buddy icon to your desktop?", "Study Buddy", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (answer == DialogResult.Yes)
                {
                    try { CreateShortcut(lnk); Log("Desktop shortcut created"); }
                    catch (Exception e) { Log("Shortcut failed: " + e.Message); }
                }
            }
            settings["shortcutAsked"] = true;
            try { File.WriteAllText(settingsPath, Json.Serialize(settings)); } catch { }
        }

        static void CreateShortcut(string lnkPath)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            Type t = link.GetType();
            string exe = Application.ExecutablePath;
            t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { exe });
            t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { baseDir });
            t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { exe + ",0" });
            t.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "Study Buddy: quizzes, flashcards and notes from your PDFs" });
            t.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
        }

        // ---------- helpers ----------

        static void CleanupOldExe()
        {
            try { string bak = Application.ExecutablePath + ".old"; if (File.Exists(bak)) File.Delete(bak); } catch { }
        }

        static Dictionary<string, object> ReadJson(string path)
        {
            try { if (File.Exists(path)) return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path)) ?? new Dictionary<string, object>(); }
            catch (Exception e) { Log("Could not read " + Path.GetFileName(path) + ": " + e.Message); }
            return new Dictionary<string, object>();
        }

        static string ReadString(string path, string key) { return Str(ReadJson(path), key); }

        static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) && v != null ? v.ToString().Trim() : "";
        }

        static Version ParseVer(string s)
        {
            Version v;
            string t = (s ?? "").Trim().TrimStart('v', 'V');
            if (t == "") return new Version(0, 0, 0);
            int dots = t.Split('.').Length - 1;
            for (; dots < 2; dots++) t += ".0"; // "1.2" -> "1.2.0" so it compares equal to "1.2.0"
            return Version.TryParse(t, out v) ? v : new Version(0, 0, 0);
        }

        static void CopyDir(string src, string dst)
        {
            Directory.CreateDirectory(dst);
            foreach (string f in Directory.GetFiles(src)) File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
            foreach (string d in Directory.GetDirectories(src)) CopyDir(d, Path.Combine(dst, Path.GetFileName(d)));
        }

        static void DeleteDir(string path)
        {
            try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch (Exception e) { Log("Could not delete " + path + ": " + e.Message); }
        }

        static void Log(string msg)
        {
            try { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine); } catch { }
        }

        static void Fail(string msg)
        {
            Log(msg);
            if (!testMode) MessageBox.Show(msg, "Study Buddy", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    // Splash window: an index card with a highlighter stroke, matching the app.
    class Splash : Form
    {
        string status = "Starting...";
        int phase; // position of the moving progress segment
        readonly System.Windows.Forms.Timer anim = new System.Windows.Forms.Timer();
        readonly string version;
        static readonly Color Paper = Color.FromArgb(0xF5, 0xF7, 0xFB), Ink = Color.FromArgb(0x18, 0x23, 0x3D),
            Ink2 = Color.FromArgb(0x4E, 0x5B, 0x76), Blue = Color.FromArgb(0x2C, 0x5B, 0xA8), Rule = Color.FromArgb(0xD9, 0xDF, 0xEA),
            Hi = Color.FromArgb(0xF6, 0xE0, 0x5E), Red = Color.FromArgb(0xE2, 0x82, 0x7E), CardRule = Color.FromArgb(0xC9, 0xD6, 0xEE);

        public Splash(string version)
        {
            this.version = version;
            Text = "Study Buddy";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Paper;
            DoubleBuffered = true;
            float scale;
            using (Graphics sg = CreateGraphics()) scale = sg.DpiX / 96f;
            ClientSize = new Size((int)(460 * scale), (int)(220 * scale));
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            anim.Interval = 30;
            anim.Tick += delegate { phase = (phase + 6) % 520; Invalidate(); };
            anim.Start();
        }

        public void SetStatus(string s)
        {
            if (IsDisposed) return;
            if (InvokeRequired) { try { BeginInvoke(new Action<string>(SetStatus), s); } catch { } return; }
            status = s;
            Invalidate();
        }

        protected override void Dispose(bool disposing) { if (disposing) anim.Dispose(); base.Dispose(disposing); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            // Everything is drawn on a 460x220 canvas, scaled for high-DPI screens.
            float s = ClientSize.Width / 460f;
            g.ScaleTransform(s, s);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            using (Pen border = new Pen(Rule)) g.DrawRectangle(border, 0, 0, 459, 219);

            // Index card icon
            Rectangle card = new Rectangle(40, 44, 64, 46);
            using (SolidBrush white = new SolidBrush(Color.FromArgb(0xFF, 0xFD, 0xF6))) g.FillRectangle(white, card);
            using (Pen p = new Pen(CardRule, 1.5f)) { g.DrawLine(p, 46, 70, 98, 70); g.DrawLine(p, 46, 80, 88, 80); }
            using (Pen p = new Pen(Red, 2f)) g.DrawLine(p, 40, 58, 104, 58);
            using (Pen p = new Pen(Blue, 2.5f)) g.DrawRectangle(p, card);

            // Title with a highlighter stroke behind it
            using (Font title = new Font("Segoe UI", 22f, FontStyle.Bold))
            {
                SizeF sz = g.MeasureString("Study Buddy", title);
                using (SolidBrush hi = new SolidBrush(Hi)) g.FillRectangle(hi, 122, 68, sz.Width - 10, 16);
                using (SolidBrush ink = new SolidBrush(Ink)) g.DrawString("Study Buddy", title, ink, 118, 42);
            }
            using (Font small = new Font("Segoe UI", 9f))
            using (SolidBrush ink2 = new SolidBrush(Ink2))
            {
                g.DrawString(version != "" ? "Version " + version : "Developer copy", small, ink2, 122, 96);
                using (Font body = new Font("Segoe UI", 10f)) g.DrawString(status, body, ink2, 38, 148);
            }

            // Progress track with a moving blue segment (the updater can't know download size ahead of time).
            using (SolidBrush track = new SolidBrush(Rule)) g.FillRectangle(track, 40, 182, 380, 4);
            int x = phase - 120, w = 120;
            int left = Math.Max(40, 40 + x), right = Math.Min(420, 40 + x + w);
            if (right > left) using (SolidBrush blue = new SolidBrush(Blue)) g.FillRectangle(blue, left, 182, right - left, 4);
        }
    }
}
