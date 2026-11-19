// yybox.exe — yy 收纳箱原生引擎
//
// 职责：以管理员权限运行，把游戏窗口“收养”为 Harness 主窗口的 owned window，
// 并精确摆放到面板视口矩形上。这样游戏是原生渲染（零拷贝、无编码延迟），
// 但不会出现在任务栏 / Alt-Tab，也不会有自己的标题栏和边框。
//
// 协议：TCP 127.0.0.1:<port>，行分隔 JSON。首行必须是 {"token":"..."}。
// 编译：csc /target:winexe /out:yybox.exe yybox.cs /r:System.Web.Extensions.dll

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Drawing;
using System.Drawing.Imaging;

static class YyBox
{
    // ───────────────────────────── Win32 ─────────────────────────────

    delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowLongPtr(IntPtr h, int index, IntPtr value);
    [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);

    const int GWL_STYLE = -16;
    const int GWL_EXSTYLE = -20;
    const int GWLP_HWNDPARENT = -8;

    const long WS_CAPTION = 0x00C00000;
    const long WS_THICKFRAME = 0x00040000;
    const long WS_SYSMENU = 0x00080000;
    const long WS_MINIMIZEBOX = 0x00020000;
    const long WS_MAXIMIZEBOX = 0x00010000;
    const long WS_POPUP = 0x80000000;
    const long WS_VISIBLE = 0x10000000;

    const long WS_EX_TOPMOST = 0x00000008;
    const long WS_EX_TOOLWINDOW = 0x00000080;
    const long WS_EX_APPWINDOW = 0x00040000;

    const uint SWP_NOSIZE = 0x0001;
    const uint SWP_NOMOVE = 0x0002;
    const uint SWP_NOZORDER = 0x0004;
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_FRAMECHANGED = 0x0020;
    const uint SWP_SHOWWINDOW = 0x0040;

    const uint GA_ROOTOWNER = 3;

    // ───────────────────────────── 状态 ─────────────────────────────

    sealed class Tracked
    {
        public int Pid;
        public IntPtr Hwnd;
        public IntPtr Host;
        public long Style;
        public long ExStyle;
        public IntPtr Owner;
        public RECT Rect;
        public double[] Frac;
        public bool Hidden;
        public bool Shown = true;
        public bool AutoHidden;
        public bool ChromeStripped;
        public bool StyleRefused;   // 游戏拒绝改样式（如 KOF'97），改用窗口区域裁剪
        public bool Clipped;
        public bool FixedSize;      // 游戏坚持自己的窗口尺寸
        public int SizeFails;       // 连续几次改尺寸失败
        public int LastSizeTry;     // 上次尝试改尺寸的时刻（Environment.TickCount）
        public bool Placed;         // 至少成功摆过一次
        public bool RegionEmpty;    // 用「空区域」让它看不见（有些程序会自己重新显示窗口，SW_HIDE 压不住）
        public int UnwantTicks;     // 连续几拍「不该显示」（迟滞用）
        public int WantTicks;       // 连续几拍「该显示」
        public string Title = "";
        public string Exe = "";
    }

    static readonly Dictionary<long, Tracked> Windows = new Dictionary<long, Tracked>();
    static readonly object Sync = new object();
    static string Token = "";
    static int Port;
    static string LogPath = "";
    static volatile bool Running = true;
    static IntPtr HostHwnd = IntPtr.Zero;
    static string HostTitleHint = "DeepSeek Harness";

    // ───────────────────────────── 日志 ─────────────────────────────

    static void Log(string message)
    {
        if (string.IsNullOrEmpty(LogPath)) return;
        try
        {
            File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + Environment.NewLine, Encoding.UTF8);
        }
        catch { }
    }

    // ───────────────────────────── 主入口 ─────────────────────────────

    [STAThread]
    static int Main(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--port" && i + 1 < args.Length) Port = int.Parse(args[++i]);
            else if (a == "--token" && i + 1 < args.Length) Token = args[++i];
            else if (a == "--log" && i + 1 < args.Length) LogPath = args[++i];
            else if (a == "--host" && i + 1 < args.Length) HostHwnd = (IntPtr)long.Parse(args[++i]);
            else if (a == "--host-title" && i + 1 < args.Length) HostTitleHint = args[++i];
        }

        try { SetProcessDpiAwarenessContext((IntPtr)(-4)); }
        catch { try { SetProcessDPIAware(); } catch { } }

        if (Port <= 0) Port = 47311;
        if (string.IsNullOrEmpty(Token)) Token = "dev";

        Log("engine start pid=" + Process.GetCurrentProcess().Id + " port=" + Port + " elevated=" + IsElevated());

        Thread server = new Thread(() => Serve()) { IsBackground = true };
        server.Start();

        Thread watch = new Thread(() => Watch()) { IsBackground = true };
        watch.Start();

        while (Running) Thread.Sleep(250);
        Log("engine exit");
        // 监听线程可能在 AcceptTcpClient 上阻塞，进程不能靠 Main 返回退出；
        // 曾经因此留下一个「端口还开着但没人应答」的僵尸引擎，导致下次启动一直卡住。
        Environment.Exit(0);
        return 0;
    }

    static bool IsElevated()
    {
        try { return GetIntegrityRid(GetCurrentProcess()) >= 0x3000; }
        catch { return false; }
    }

    static uint GetIntegrityRid(IntPtr processHandle)
    {
        IntPtr token;
        if (!OpenProcessToken(processHandle, 0x0008, out token)) return 0;
        try
        {
            int size = 0;
            GetTokenInformation(token, 25, IntPtr.Zero, 0, out size);
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!GetTokenInformation(token, 25, buffer, size, out size)) return 0;
                IntPtr sid = Marshal.ReadIntPtr(buffer);
                IntPtr countPtr = GetSidSubAuthorityCount(sid);
                if (countPtr == IntPtr.Zero) return 0;
                byte count = Marshal.ReadByte(countPtr);
                if (count == 0) return 0;
                IntPtr sub = GetSidSubAuthority(sid, (uint)(count - 1));
                if (sub == IntPtr.Zero) return 0;
                return (uint)Marshal.ReadInt32(sub);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { CloseHandle(token); }
    }

    // ───────────────────────────── 监视 ─────────────────────────────

    /// <summary>前台窗口是不是 Harness 这一族（主窗口本身，或被它拥有的窗口，例如游戏窗口）。
    /// 模拟器/老游戏常弹出自己新建的顶层窗口（登录框、公告框），这些窗口不属于 Harness，
    /// 但同样属于「游戏进程」，也不能因此把游戏藏起来。</summary>
    static bool HostIsForeground(IntPtr host)
    {
        try
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            if (fg == host) return true;
            if (GetAncestor(fg, GA_ROOTOWNER) == host) return true;

            uint fgPid = 0;
            GetWindowThreadProcessId(fg, out fgPid);
            if (fgPid != 0)
            {
                // Harness 进程可能同时有多个顶层窗口（主窗、调试窗等），只要焦点在这个进程里就算
                uint hostPid = 0;
                GetWindowThreadProcessId(host, out hostPid);
                if (hostPid != 0 && fgPid == hostPid) return true;

                lock (Sync)
                {
                    foreach (Tracked t in Windows.Values)
                    {
                        if ((uint)t.Pid == fgPid) return true;
                    }
                }
            }
            return false;
        }
        catch { return true; }
    }

    /// <summary>当前前台窗口的一句话描述，用于日志。</summary>
    static string ForegroundBrief()
    {
        try
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return "none";
            uint pid = 0;
            GetWindowThreadProcessId(fg, out pid);
            StringBuilder cls = new StringBuilder(128);
            GetClassName(fg, cls, 128);
            StringBuilder title = new StringBuilder(160);
            GetWindowText(fg, title, 160);
            bool ours = HostHwnd != IntPtr.Zero && (fg == HostHwnd || GetAncestor(fg, GA_ROOTOWNER) == HostHwnd);
            return "hwnd=0x" + fg.ToString("X") + " pid=" + pid + " cls=" + cls + " ours=" + ours + " title=" + title;
        }
        catch { return "?"; }
    }

    /// <summary>隐藏/显示时维护窗口区域。有些程序（模拟器、老游戏）会自己把窗口重新显示出来，
    /// 只靠 ShowWindow(SW_HIDE) 压不住，所以隐藏时再套一个空区域。</summary>
    static void EnsureRegion(Tracked t, bool visible)
    {
        if (!visible)
        {
            if (t.RegionEmpty) return;
            SetWindowRgn(t.Hwnd, CreateRectRgn(0, 0, 0, 0), true);   // 区域交给系统管理，不要 DeleteObject
            t.RegionEmpty = true;
            return;
        }
        if (!t.RegionEmpty) return;
        SetWindowRgn(t.Hwnd, IntPtr.Zero, true);
        t.RegionEmpty = false;
        t.Clipped = false;
    }

    static void Watch()
    {
        int gone = 0;
        while (Running)
        {
            Thread.Sleep(700);
            try
            {
                if (HostHwnd != IntPtr.Zero && !IsWindow(HostHwnd))
                {
                    gone++;
                    if (gone >= 4) { Log("host window gone, exit"); Running = false; }
                }
                else gone = 0;

                lock (Sync)
                {
                    List<long> dead = new List<long>();
                    foreach (KeyValuePair<long, Tracked> pair in Windows)
                    {
                        Tracked t = pair.Value;
                        if (!IsWindow(t.Hwnd)) { dead.Add(pair.Key); continue; }

                        // 该不该显示：面板要可见（Hidden=false）+ Harness 这一族在前台 + 宿主没最小化。
                        bool want = !t.Hidden && !IsIconic(t.Host) && HostIsForeground(t.Host);

                        if (!want)
                        {
                            // 迟滞：游戏自己弹窗、点任务栏等瞬间失焦不要立刻隐藏，连续两拍才动手
                            if (t.WantTicks > 0) { t.WantTicks = 0; }
                            t.UnwantTicks++;
                            if (t.UnwantTicks < 2) continue;
                            if (t.UnwantTicks == 2)
                            {
                                Log("hide hwnd=0x" + t.Hwnd.ToString("X") + " hidden=" + t.Hidden +
                                    " iconic=" + IsIconic(t.Host) + " fg=" + ForegroundBrief());
                            }
                            EnsureRegion(t, false);
                            if (IsWindowVisible(t.Hwnd)) ShowWindow(t.Hwnd, 0);
                            if (t.Shown) { t.Shown = false; t.AutoHidden = true; }
                            continue;
                        }

                        t.UnwantTicks = 0;
                        if (t.WantTicks < 2)
                        {
                            t.WantTicks++;
                            if (t.WantTicks == 1)
                            {
                                Log("show hwnd=0x" + t.Hwnd.ToString("X") + " fg=" + ForegroundBrief());
                            }
                        }
                        EnsureRegion(t, true);
                        // 有些程序会自己把自己显示出来，所以看实际可见状态而不是我们记的标志
                        if (!IsWindowVisible(t.Hwnd)) ShowWindow(t.Hwnd, 5);
                        t.Shown = true;
                        t.AutoHidden = false;
                        Place(t);
                        // 有窗口会把 owner 清掉，这里补回来
                        if (GetParent(t.Hwnd) == IntPtr.Zero && GetWindowLongPtr(t.Hwnd, GWLP_HWNDPARENT) == IntPtr.Zero)
                        {
                            SetWindowLongPtr(t.Hwnd, GWLP_HWNDPARENT, t.Host);
                        }
                        // 游戏常在初始化后自行重设窗口样式，把标题栏又装回去
                        if (t.ChromeStripped && !t.StyleRefused) StripChrome(t);
                    }
                    foreach (long key in dead) Windows.Remove(key);
                }
            }
            catch (Exception ex) { Log("watch error: " + ex.Message); }
        }
    }

    // ───────────────────────────── 服务端 ─────────────────────────────

    static void Serve()
    {
        TcpListener listener = null;
        try
        {
            listener = new TcpListener(IPAddress.Loopback, Port);
            listener.Start();
            Log("listening on " + Port);
        }
        catch (Exception ex)
        {
            Log("listen failed: " + ex.Message);
            Running = false;
            return;
        }

        while (Running)
        {
            try
            {
                TcpClient client = listener.AcceptTcpClient();
                Thread thread = new Thread(() => Session(client)) { IsBackground = true };
                thread.Start();
            }
            catch (Exception ex)
            {
                Log("accept error: " + ex.Message);
                Thread.Sleep(300);
            }
        }
    }

    static void Session(TcpClient client)
    {
        string remote = "?";
        try
        {
            remote = client.Client.RemoteEndPoint.ToString();
            client.NoDelay = true;
            using (NetworkStream stream = client.GetStream())
            using (StreamReader reader = new StreamReader(stream, new UTF8Encoding(false)))
            using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" })
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = 8 * 1024 * 1024;
                bool authed = false;
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (line.Length > 1024 * 1024) { writer.WriteLine("{\"ok\":false,\"error\":\"line too long\"}"); continue; }
                    Dictionary<string, object> request;
                    try { request = serializer.Deserialize<Dictionary<string, object>>(line); }
                    catch (Exception ex) { writer.WriteLine(serializer.Serialize(Err("bad json: " + ex.Message))); continue; }

                    string cmd = Str(request, "cmd");
                    if (!authed)
                    {
                        if (cmd == "auth" && Str(request, "token") == Token)
                        {
                            authed = true;
                            Dictionary<string, object> hello = new Dictionary<string, object>();
                            hello["ok"] = true;
                            hello["result"] = Hello();
                            writer.WriteLine(serializer.Serialize(hello));
                        }
                        else
                        {
                            writer.WriteLine(serializer.Serialize(Err("auth required")));
                            break;
                        }
                        continue;
                    }

                    Dictionary<string, object> response;
                    try { response = Handle(cmd, request); }
                    catch (Exception ex)
                    {
                        Log("cmd " + cmd + " failed: " + ex);
                        response = Err(ex.Message);
                    }
                    writer.WriteLine(serializer.Serialize(response));
                    if (cmd == "quit") break;
                }
            }
        }
        catch (System.IO.IOException) { /* 客户端正常断开 */ }
        catch (ObjectDisposedException) { }
        catch (Exception ex) { Log("session " + remote + " error: " + ex.GetType().Name + ": " + ex.Message); }
        finally { try { client.Close(); } catch { } }
    }

    static Dictionary<string, object> Err(string message)
    {
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["ok"] = false;
        d["error"] = message;
        return d;
    }

    static Dictionary<string, object> Ok(Dictionary<string, object> result)
    {
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["ok"] = true;
        d["result"] = result; 
        return d;
    }

    static Dictionary<string, object> Hello()
    {
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["version"] = "1.0.0";
        r["pid"] = Process.GetCurrentProcess().Id;
        r["elevated"] = IsElevated();
        r["integrity"] = "0x" + GetIntegrityRid(GetCurrentProcess()).ToString("X");
        IntPtr host = ResolveHost(IntPtr.Zero);
        r["host"] = DescribeWindow(host);
        return r;
    }

    static Dictionary<string, object> Handle(string cmd, Dictionary<string, object> request)
    {
        switch (cmd)
        {
            case "ping": return Ok(Hello());
            case "host": return Ok(HostInfo(request));
            case "attach": return Ok(Attach(request));
            case "move": return Ok(Move(request));
            case "show": return Ok(Show(request));
            case "detach": return Ok(Detach(request));
            case "kill": return Ok(Kill(request));
            case "launch": return Ok(Launch(request));
            case "track": return Ok(Track(request));
            case "shot": return Ok(Shot(request));
            case "resize": return Ok(Resize(request));
            case "windows": return Ok(WindowsInfo());
            case "quit":
                lock (Sync) { foreach (Tracked t in Windows.Values) Restore(t); Windows.Clear(); }
                Running = false;
                return Ok(new Dictionary<string, object>());
            default: return Err("unknown cmd: " + cmd);
        }
    }

    // ───────────────────────────── 参数小工具 ─────────────────────────────

    static string Str(Dictionary<string, object> d, string key)
    {
        object v;
        return d.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : "";
    }

    static long Long(Dictionary<string, object> d, string key, long fallback)
    {
        object v;
        if (!d.TryGetValue(key, out v) || v == null) return fallback;
        try { return Convert.ToInt64(v); } catch { return fallback; }
    }

    static bool Bool(Dictionary<string, object> d, string key, bool fallback)
    {
        object v;
        if (!d.TryGetValue(key, out v) || v == null) return fallback;
        if (v is bool) return (bool)v;
        string s = Convert.ToString(v);
        return s == "1" || s.Equals("true", StringComparison.OrdinalIgnoreCase);
    }

    static double[] Frac(Dictionary<string, object> d)
    {
        object v;
        if (!d.TryGetValue("frac", out v) || v == null) return null;
        System.Collections.IList list = v as System.Collections.IList;
        if (list == null || list.Count < 4) return null;
        double[] result = new double[4];
        for (int i = 0; i < 4; i++) result[i] = Convert.ToDouble(list[i]);
        return result;
    }

    // ───────────────────────────── 窗口查找 ─────────────────────────────

    static IntPtr ResolveHost(IntPtr hint)
    {
        if (hint != IntPtr.Zero && IsWindow(hint)) return hint;
        if (HostHwnd != IntPtr.Zero && IsWindow(HostHwnd)) return HostHwnd;

        IntPtr byTitle = IntPtr.Zero;
        IntPtr byClass = IntPtr.Zero;
        EnumWindows((h, l) =>
        {
            if (!IsWindowVisible(h)) return true;
            StringBuilder cls = new StringBuilder(256);
            GetClassName(h, cls, 256);
            if (cls.ToString() != "Chrome_WidgetWin_1") return true;
            StringBuilder title = new StringBuilder(512);
            GetWindowText(h, title, 512);
            string text = title.ToString();
            if (text.Length == 0) return true;
            if (text.Contains(HostTitleHint)) { byTitle = h; return false; }
            if (byClass == IntPtr.Zero) byClass = h;
            return true;
        }, IntPtr.Zero);

        HostHwnd = byTitle != IntPtr.Zero ? byTitle : byClass;
        if (HostHwnd != IntPtr.Zero) Log("host resolved 0x" + HostHwnd.ToString("X"));
        return HostHwnd;
    }

    static IntPtr FindProcessWindow(int pid, int timeoutMs)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            IntPtr found = PickBestWindow(pid);
            if (found != IntPtr.Zero) return found;
            Thread.Sleep(120);
        }
        return IntPtr.Zero;
    }

    static IntPtr PickBestWindow(int pid)
    {
        IntPtr best = IntPtr.Zero;
        long bestArea = 0;
        uint ownerPid = 0;
        EnumWindows((h, l) =>
        {
            GetWindowThreadProcessId(h, out ownerPid);
            if (ownerPid != (uint)pid) return true;
            if (!Scorable(h)) return true;
            RECT r;
            GetWindowRect(h, out r);
            long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (area > bestArea) { bestArea = area; best = h; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    static bool Scorable(IntPtr h)
    {
        if (!IsWindowVisible(h)) return false;
        RECT r;
        if (!GetWindowRect(h, out r)) return false;
        if (r.Right <= r.Left || r.Bottom <= r.Top) return false;
        long ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
        if ((ex & WS_EX_TOOLWINDOW) != 0) return false;
        StringBuilder cls = new StringBuilder(256);
        GetClassName(h, cls, 256);
        string c = cls.ToString();
        if (c == "ConsoleWindowClass" || c == "MSCTFIME UI" || c == "IME" || c == "ToolTip" || c == "SysShadow") return false;
        if (c.StartsWith("Chrome_WidgetWin_Widget")) return false;
        return true;
    }

    /// <summary>启动后追踪游戏窗口：本体进程优先，其次同目录/同启动时间的新进程（应对启动器二次拉起）。</summary>
    static IntPtr TrackWindow(int pid, string exePath, string titleHint, long sinceMs, int timeoutMs)
    {
        string dir = "";
        try { if (!string.IsNullOrEmpty(exePath)) dir = Path.GetDirectoryName(exePath) ?? ""; } catch { }
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            IntPtr best = IntPtr.Zero;
            long bestScore = -1;
            uint ownerPid = 0;
            EnumWindows((h, l) =>
            {
                if (!Scorable(h)) return true;
                GetWindowThreadProcessId(h, out ownerPid);
                int candidate = (int)ownerPid;
                bool direct = candidate == pid;
                bool related = false;
                if (!direct && sinceMs > 0)
                {
                    try
                    {
                        Process p = Process.GetProcessById(candidate);
                        long started = new DateTimeOffset(p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();
                        if (started >= sinceMs - 4000)
                        {
                            string file = "";
                            try { file = p.MainModule.FileName; } catch { }
                            if (file.Length > 0 && dir.Length > 0 && file.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) related = true;
                        }
                    }
                    catch { }
                }
                if (!direct && !related) return true;

                StringBuilder title = new StringBuilder(512);
                GetWindowText(h, title, 512);
                string text = title.ToString();

                RECT r;
                GetWindowRect(h, out r);
                long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
                long score = area + (direct ? 1000000000L : 0);
                if (!string.IsNullOrEmpty(titleHint) && text.IndexOf(titleHint, StringComparison.OrdinalIgnoreCase) >= 0) score += 500000000L;
                if (text.Length == 0) score -= 1000000L;
                if (score > bestScore) { bestScore = score; best = h; }
                return true;
            }, IntPtr.Zero);

            if (best != IntPtr.Zero) return best;
            Thread.Sleep(150);
            if (watch.ElapsedMilliseconds > timeoutMs) break;
        }
        return IntPtr.Zero;
    }


    static Dictionary<string, object> DescribeWindow(IntPtr h)
    {
        Dictionary<string, object> d = new Dictionary<string, object>();
        if (h == IntPtr.Zero) { d["hwnd"] = 0L; return d; }
        RECT r, c;
        GetWindowRect(h, out r);
        GetClientRect(h, out c);
        POINT p = new POINT();
        ClientToScreen(h, ref p);
        uint pid = 0;
        GetWindowThreadProcessId(h, out pid);
        StringBuilder title = new StringBuilder(512);
        GetWindowText(h, title, 512);
        StringBuilder cls = new StringBuilder(256);
        GetClassName(h, cls, 256);
        d["hwnd"] = (long)h;
        d["pid"] = (int)pid;
        d["title"] = title.ToString();
        d["cls"] = cls.ToString();
        d["visible"] = IsWindowVisible(h);
        d["iconic"] = IsIconic(h);
        d["rect"] = new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
        d["client"] = new int[] { p.X, p.Y, c.Right - c.Left, c.Bottom - c.Top };
        d["style"] = "0x" + GetWindowLongPtr(h, GWL_STYLE).ToInt64().ToString("X");
        d["exstyle"] = "0x" + GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64().ToString("X");
        return d;
    }

    static Dictionary<string, object> HostInfo(Dictionary<string, object> request)
    {
        IntPtr hint = (IntPtr)Long(request, "host", 0);
        string title = Str(request, "hostTitle");
        if (!string.IsNullOrEmpty(title)) HostTitleHint = title;
        IntPtr host = ResolveHost(hint);
        Dictionary<string, object> r = DescribeWindow(host);
        r["elevated"] = IsElevated();
        return r;
    }

    // ───────────────────────────── 收养与摆放 ─────────────────────────────

    static IntPtr PickWindow(Dictionary<string, object> request, out int pid)
    {
        pid = (int)Long(request, "pid", 0);
        IntPtr hwnd = (IntPtr)Long(request, "hwnd", 0);
        if (hwnd != IntPtr.Zero && IsWindow(hwnd)) return hwnd;
        if (pid > 0)
        {
            int timeout = (int)Long(request, "timeoutMs", 15000);
            return FindProcessWindow(pid, timeout);
        }
        return IntPtr.Zero;
    }

    static Dictionary<string, object> Attach(Dictionary<string, object> request)
    {
        int pid;
        IntPtr hwnd = PickWindow(request, out pid);
        if (hwnd == IntPtr.Zero) throw new Exception("未找到游戏窗口（pid=" + pid + "）");
        uint windowPid = 0;
        GetWindowThreadProcessId(hwnd, out windowPid);
        pid = (int)windowPid;

        IntPtr host = ResolveHost((IntPtr)Long(request, "host", 0));
        if (host == IntPtr.Zero) throw new Exception("未找到 Harness 主窗口");

        if (IsIconic(host)) { ShowWindow(host, 9); SetForegroundWindow(host); Thread.Sleep(250); }
        bool stripChrome = Bool(request, "chrome", true);
        double[] frac = Frac(request) ?? new double[] { 0.1, 0.1, 0.8, 0.8 };

        lock (Sync)
        {
            Tracked tracked;
            long key = (long)hwnd;
            if (!Windows.TryGetValue(key, out tracked))
            {
                tracked = new Tracked();
                tracked.Hwnd = hwnd;
                tracked.Pid = pid;
                tracked.Style = GetWindowLongPtr(hwnd, GWL_STYLE).ToInt64();
                tracked.ExStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
                tracked.Owner = GetWindowLongPtr(hwnd, GWLP_HWNDPARENT);
                GetWindowRect(hwnd, out tracked.Rect);
                StringBuilder title = new StringBuilder(512);
                GetWindowText(hwnd, title, 512);
                tracked.Title = title.ToString();
                try { tracked.Exe = Process.GetProcessById(pid).MainModule.FileName; } catch { }
                Windows[key] = tracked;
            }

            tracked.Host = host;
            tracked.Frac = frac;
            tracked.Hidden = false;

            Apply(tracked, stripChrome);
            Log("attached pid=" + pid + " hwnd=0x" + hwnd.ToString("X") + " host=0x" + host.ToString("X"));

            Dictionary<string, object> r = DescribeWindow(hwnd);
            r["pid"] = pid;
            r["attached"] = true;
            return r;
        }
    }

    /// <summary>剥掉标题栏/边框，改成无边框 popup。可重复调用（游戏会自己把样式改回去）。</summary>
    static void StripChrome(Tracked t)
    {
        // 已经确认这个窗口不吃样式修改：不要再试。
        // SetWindowLongPtr 是跨进程同步消息（WM_STYLECHANGING），反复戳会卡住游戏的消息循环。
        if (t.StyleRefused) return;
        long style = GetWindowLongPtr(t.Hwnd, GWL_STYLE).ToInt64();
        bool clean = (style & WS_CAPTION) == 0 && (style & WS_THICKFRAME) == 0
                     && (style & WS_POPUP) != 0 && (style & WS_VISIBLE) != 0;
        if (clean) { t.StyleRefused = false; return; }
        style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
        style |= WS_POPUP | WS_VISIBLE;
        SetWindowLongPtr(t.Hwnd, GWL_STYLE, (IntPtr)style);
        SetWindowPos(t.Hwnd, IntPtr.Zero, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

        long after = GetWindowLongPtr(t.Hwnd, GWL_STYLE).ToInt64();
        t.StyleRefused = (after & WS_CAPTION) != 0;
        if (t.StyleRefused) Log("strip refused hwnd=0x" + t.Hwnd.ToString("X") + " style=0x" + after.ToString("X"));
    }

    /// <summary>客户区相对窗口左上角的偏移（含标题栏/边框）。</summary>
    static void ClientOffset(Tracked t, out int offX, out int offY)
    {
        offX = 0; offY = 0;
        RECT wr; POINT p = new POINT();
        if (!GetWindowRect(t.Hwnd, out wr)) return;
        if (!ClientToScreen(t.Hwnd, ref p)) return;
        offX = p.X - wr.Left;
        offY = p.Y - wr.Top;
    }

    /// <summary>游戏拒绝改样式时的兜底：把窗口裁成「只有目标矩形可见」。</summary>
    static void ClipToTarget(Tracked t, int tx, int ty, int tw, int th)
    {
        int offX, offY;
        ClientOffset(t, out offX, out offY);
        if (offX < 0) offX = 0;
        if (offY < 0) offY = 0;

        RECT wr;
        GetWindowRect(t.Hwnd, out wr);
        int ww = wr.Right - wr.Left;
        int wh = wr.Bottom - wr.Top;
        int needW = tw + offX;
        int needH = th + offY;

        uint flags = SWP_NOACTIVATE | SWP_NOZORDER;
        if (!t.Hidden && t.Shown) flags |= SWP_SHOWWINDOW;
        SetWindowPos(t.Hwnd, IntPtr.Zero, tx - offX, ty - offY,
                     Math.Max(ww, needW), Math.Max(wh, needH), flags);

        IntPtr rgn = CreateRectRgn(offX, offY, offX + tw, offY + th);
        SetWindowRgn(t.Hwnd, rgn, true);
        t.Clipped = true;
        t.RegionEmpty = false;
    }

    static void Apply(Tracked t, bool stripChrome)
    {
        if (stripChrome)
        {
            StripChrome(t);
            t.ChromeStripped = true;
        }

        long ex = GetWindowLongPtr(t.Hwnd, GWL_EXSTYLE).ToInt64();
        ex |= WS_EX_TOOLWINDOW;
        ex &= ~WS_EX_APPWINDOW;
        SetWindowLongPtr(t.Hwnd, GWL_EXSTYLE, (IntPtr)ex);

        SetWindowLongPtr(t.Hwnd, GWLP_HWNDPARENT, t.Host);
        Place(t);
    }

    static void Place(Tracked t)
    {
        if (IsIconic(t.Host)) return;
        RECT client;
        if (!GetClientRect(t.Host, out client)) return;
        POINT origin = new POINT();
        ClientToScreen(t.Host, ref origin);

        double width = client.Right - client.Left;
        double height = client.Bottom - client.Top;
        if (width < 200 || height < 150) return;

        int x = origin.X + (int)Math.Round(t.Frac[0] * width);
        int y = origin.Y + (int)Math.Round(t.Frac[1] * height);
        int w = Math.Max(40, (int)Math.Round(t.Frac[2] * width));
        int h = Math.Max(40, (int)Math.Round(t.Frac[3] * height));

        if (t.Clipped)
        {
            ClipToTarget(t, x, y, w, h);
            return;
        }

        uint flags = SWP_NOACTIVATE | SWP_NOZORDER;
        if (!t.Hidden && t.Shown) flags |= SWP_SHOWWINDOW;

        // 判定过「不吃尺寸」的窗口每 12 秒再试一次：有些游戏初始化完成后才允许改大小
        bool allowResize = !t.FixedSize || unchecked(Environment.TickCount - t.LastSizeTry) > 12000;

        if (allowResize)
        {
            SetWindowPos(t.Hwnd, IntPtr.Zero, x, y, w, h, flags);
            t.Placed = true;

            RECT now;
            GetWindowRect(t.Hwnd, out now);
            int nw = now.Right - now.Left;
            int nh = now.Bottom - now.Top;

            if (Math.Abs(nw - w) > 8 || Math.Abs(nh - h) > 8)
            {
                // 只重试同一个目标（不要用差值去补偿：游戏不接受时会越补偿越离谱）
                SetWindowPos(t.Hwnd, IntPtr.Zero, x, y, w, h, flags);
                GetWindowRect(t.Hwnd, out now);
                nw = now.Right - now.Left;
                nh = now.Bottom - now.Top;
            }

            t.LastSizeTry = Environment.TickCount;

            if (Math.Abs(nw - w) <= 8 && Math.Abs(nh - h) <= 8)
            {
                t.SizeFails = 0;
                t.FixedSize = false;
                return;
            }

            t.SizeFails++;
            if (t.SizeFails >= 3)
            {
                t.FixedSize = true;
                Log("fixed size hwnd=0x" + t.Hwnd.ToString("X") + " own=" + nw + "x" + nh +
                    " target=" + w + "x" + h);
            }
        }

        // 认定不吃尺寸：窗口比视口大就按视口裁剪，否则在视口里居中
        RECT cur;
        GetWindowRect(t.Hwnd, out cur);
        int cw = cur.Right - cur.Left;
        int ch = cur.Bottom - cur.Top;
        if (cw > w + 8 || ch > h + 8) { ClipToTarget(t, x, y, w, h); return; }
        SetWindowPos(t.Hwnd, IntPtr.Zero, x + (w - cw) / 2, y + (h - ch) / 2, 0, 0,
                     flags | SWP_NOSIZE);
    }

    static Dictionary<string, object> Move(Dictionary<string, object> request)
    {
        double[] frac = Frac(request);
        lock (Sync)
        {
            int changed = 0;
            foreach (Tracked t in Windows.Values)
            {
                if (frac != null) t.Frac = frac;
                Place(t);
                changed++;
            }
            Dictionary<string, object> r = new Dictionary<string, object>();
            r["moved"] = changed;
            return r;
        }
    }

    // 诊断用：直接给窗口一个尺寸，回报它最终接受的尺寸（判断游戏是否允许改大小）
    static Dictionary<string, object> Resize(Dictionary<string, object> request)
    {
        long hwnd = Long(request, "hwnd", 0);
        int w = (int)Long(request, "w", 0);
        int h = (int)Long(request, "h", 0);
        Dictionary<string, object> r = new Dictionary<string, object>();
        if (hwnd == 0) { r["error"] = "hwnd required"; return r; }
        RECT rc;
        GetWindowRect((IntPtr)hwnd, out rc);
        int x = rc.Left;
        int y = rc.Top;
        SetWindowPos((IntPtr)hwnd, IntPtr.Zero, x, y, w, h, 0x0004 | 0x0010); // SWP_NOZORDER|SWP_NOACTIVATE，允许改大小
        Thread.Sleep(500);
        GetWindowRect((IntPtr)hwnd, out rc);
        r["asked"] = new int[] { w, h };
        r["got"] = new int[] { rc.Right - rc.Left, rc.Bottom - rc.Top };
        r["accepted"] = (rc.Right - rc.Left) == w && (rc.Bottom - rc.Top) == h;
        lock (Sync)
        {
            foreach (Tracked t in Windows.Values)
            {
                if ((long)t.Hwnd != hwnd) continue;
                t.FixedSize = false;
                t.SizeFails = 0;
                t.Placed = false;
                t.Clipped = false;
            }
        }
        return r;
    }

    static Dictionary<string, object> Show(Dictionary<string, object> request)
    {
        bool on = Bool(request, "on", true);
        long only = Long(request, "hwnd", 0);
        lock (Sync)
        {
            foreach (KeyValuePair<long, Tracked> pair in Windows)
            {
                if (only != 0 && pair.Key != only) continue;
                Tracked t = pair.Value;
                t.Hidden = !on;
                t.Shown = on;
                t.AutoHidden = false;
                EnsureRegion(t, on);
                if (on) { ShowWindow(t.Hwnd, 5); Place(t); }
                else ShowWindow(t.Hwnd, 0);
            }
        }
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["on"] = on;
        return r;
    }

    static void Restore(Tracked t)
    {
        try
        {
            if (!IsWindow(t.Hwnd)) return;
            if (t.Clipped || t.RegionEmpty) { SetWindowRgn(t.Hwnd, IntPtr.Zero, true); t.Clipped = false; t.RegionEmpty = false; }
            SetWindowLongPtr(t.Hwnd, GWL_STYLE, (IntPtr)t.Style);
            SetWindowLongPtr(t.Hwnd, GWL_EXSTYLE, (IntPtr)t.ExStyle);
            SetWindowLongPtr(t.Hwnd, GWLP_HWNDPARENT, t.Owner);
            SetWindowPos(t.Hwnd, IntPtr.Zero, t.Rect.Left, t.Rect.Top, t.Rect.Right - t.Rect.Left, t.Rect.Bottom - t.Rect.Top, SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        }
        catch { }
    }

    static Dictionary<string, object> Detach(Dictionary<string, object> request)
    {
        long hwnd = Long(request, "hwnd", 0);
        lock (Sync)
        {
            if (hwnd != 0)
            {
                Tracked t;
                if (Windows.TryGetValue(hwnd, out t)) { Restore(t); Windows.Remove(hwnd); }
            }
            else
            {
                foreach (Tracked t in Windows.Values) Restore(t);
                Windows.Clear();
            }
        }
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["attached"] = Windows.Count;
        return r;
    }

    static Dictionary<string, object> Kill(Dictionary<string, object> request)
    {
        int pid = (int)Long(request, "pid", 0);
        long hwnd = Long(request, "hwnd", 0);
        if (pid == 0 && hwnd != 0)
        {
            uint ownerPid2 = 0;
            GetWindowThreadProcessId((IntPtr)hwnd, out ownerPid2);
            pid = (int)ownerPid2;
        }
        if (pid <= 0) throw new Exception("缺少 pid");
        lock (Sync)
        {
            foreach (Tracked t in new List<Tracked>(Windows.Values))
            {
                if (t.Pid != pid) continue;
                Restore(t);
                Windows.Remove((long)t.Hwnd);
            }
        }
        Process process = Process.GetProcessById(pid);
        Log("kill pid=" + pid);
        process.Kill();
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["killed"] = pid;
        return r;
    }

    static Dictionary<string, object> Launch(Dictionary<string, object> request)
    {
        string path = Str(request, "path");
        if (!File.Exists(path)) throw new Exception("文件不存在：" + path);
        string arguments = Str(request, "args");
        string workdir = Str(request, "workdir");
        if (string.IsNullOrEmpty(workdir)) workdir = Path.GetDirectoryName(path);

        ProcessStartInfo info = new ProcessStartInfo(path, arguments);
        info.WorkingDirectory = workdir;
        info.UseShellExecute = false;
        long startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        Process process = Process.Start(info);
        int timeout = (int)Long(request, "timeoutMs", 20000);
        IntPtr hwnd = TrackWindow(process.Id, path, Str(request, "title"), startedAt, timeout);

        Dictionary<string, object> r = new Dictionary<string, object>();
        r["pid"] = process.Id;
        r["hwnd"] = (long)hwnd;
        r["elevated"] = IsElevated();
        if (hwnd != IntPtr.Zero) r["window"] = DescribeWindow(hwnd);
        return r;
    }

    static Dictionary<string, object> Shot(Dictionary<string, object> request)
    {
        IntPtr host = ResolveHost((IntPtr)Long(request, "host", 0));
        if (host == IntPtr.Zero) throw new Exception("未找到 Harness 主窗口");
        string path = Str(request, "path");
        if (string.IsNullOrEmpty(path)) path = Path.Combine(Path.GetTempPath(), "yybox-shot-" + DateTime.Now.ToString("HHmmss") + ".png");
        RECT client;
        GetClientRect(host, out client);
        POINT origin = new POINT();
        ClientToScreen(host, ref origin);
        int width = client.Right - client.Left, height = client.Bottom - client.Top;
        using (Bitmap bitmap = new Bitmap(Math.Max(1, width), Math.Max(1, height)))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.CopyFromScreen(origin.X, origin.Y, 0, 0, new Size(bitmap.Width, bitmap.Height));
            bitmap.Save(path, ImageFormat.Png);
        }
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["path"] = path;
        r["size"] = new int[] { width, height };
        return r;
    }

    static Dictionary<string, object> Track(Dictionary<string, object> request)
    {
        int pid = (int)Long(request, "pid", 0);
        string path = Str(request, "path");
        string title = Str(request, "title");
        long sinceMs = Long(request, "sinceMs", 0);
        int timeout = (int)Long(request, "timeoutMs", 20000);
        IntPtr hwnd = TrackWindow(pid, path, title, sinceMs, timeout);

        Dictionary<string, object> r = new Dictionary<string, object>();
        r["found"] = hwnd != IntPtr.Zero;
        if (hwnd != IntPtr.Zero)
        {
            uint ownerPid = 0;
            GetWindowThreadProcessId(hwnd, out ownerPid);
            r["pid"] = (int)ownerPid;
            r["window"] = DescribeWindow(hwnd);
            r["hwnd"] = (long)hwnd;
        }
        else r["pid"] = pid;
        return r;
    }

    static Dictionary<string, object> WindowsInfo()
    {
        List<object> list = new List<object>();
        lock (Sync)
        {
            foreach (Tracked t in Windows.Values)
            {
                Dictionary<string, object> d = DescribeWindow(t.Hwnd);
                d["pid"] = t.Pid;
                d["title"] = t.Title;
                d["exe"] = t.Exe;
                d["frac"] = t.Frac;
                d["hidden"] = t.Hidden;
                d["fixedSize"] = t.FixedSize;
                list.Add(d);
            }
        }
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["windows"] = list;
        r["host"] = DescribeWindow(ResolveHost(IntPtr.Zero));
        r["elevated"] = IsElevated();
        return r;
    }

    // ───────────────────────────── 令牌 / 完整性 ─────────────────────────────

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, int length, out int returned);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
}
