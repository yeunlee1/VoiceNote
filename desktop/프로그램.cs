// 회의록 웹 화면을 독립 Windows 창에 표시하고 로컬 서버와 저장 폴더를 관리한다.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("VoiceNote")]
[assembly: AssemblyProduct("VoiceNote")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

internal static class Program
{
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [STAThread]
    private static int Main(string[] args)
    {
        bool selfTest = args.Length == 2 && args[0] == "--self-test";
        if (args.Length == 1 && args[0] == "--check-runtime")
        {
            try { CoreWebView2Environment.GetAvailableBrowserVersionString(); return 0; }
            catch { return 20; }
        }
        string root = selfTest ? Path.GetFullPath(args[1]) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MeetingJournal");
        Directory.CreateDirectory(root);
        bool created;
        using (var mutex = new Mutex(true, selfTest ? "Local\\MeetingJournalTest_" + Process.GetCurrentProcess().Id : "Local\\MeetingJournalDesktop", out created))
        {
            if (!created) { MessageBox.Show("VoiceNote가 이미 실행 중입니다. 작업 표시줄에서 열린 창을 선택하세요.", "VoiceNote"); return 0; }
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var window = new MeetingWindow(root, selfTest))
            {
                if (selfTest)
                {
                    var context = new ApplicationContext();
                    window.FormClosed += delegate { context.ExitThread(); };
                    var handle = window.Handle;
                    window.BeginInvoke(new Action(async delegate { await window.Initialize(); }));
                    Application.Run(context);
                }
                else Application.Run(window);
                return window.ExitCode;
            }
        }
    }
}

internal sealed class MeetingWindow : Form
{
    private readonly string dataRoot;
    private readonly bool selfTest;
    private readonly WebView2 view = new WebView2();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly Label loading = new Label();
    private Process server;
    private string readyFile;
    private Uri origin;
    private bool allowClose;
    private bool checkingClose;
    private bool closing;
    public int ExitCode { get; private set; }

    public MeetingWindow(string root, bool test)
    {
        dataRoot = root;
        selfTest = test;
        Text = "VoiceNote";
        ClientSize = new Size(1280, 820);
        MinimumSize = new Size(960, 680);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        view.Dock = DockStyle.Fill;
        loading.Dock = DockStyle.Fill;
        loading.Text = "VoiceNote를 준비하고 있습니다.";
        loading.TextAlign = ContentAlignment.MiddleCenter;
        Controls.Add(view);
        Controls.Add(loading);
        Shown += async delegate { await Initialize(); };
        FormClosing += OnClosing;
        FormClosed += delegate { closing = true; StopServer(); };
    }

    public async Task Initialize()
    {
        try
        {
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            readyFile = Path.Combine(Path.GetTempPath(), "회의록-" + Guid.NewGuid().ToString("N") + ".json");
            var start = new ProcessStartInfo(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node.exe"));
            start.Arguments = Quote(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "앱", "설치형서버.cjs")) + " --data-root " + Quote(dataRoot) + " --ready-file " + Quote(readyFile) + " --parent-pid " + Process.GetCurrentProcess().Id;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory;
            server = Process.Start(start);
            for (int count = 0; !File.Exists(readyFile); count++)
            {
                if (closing) return;
                if (server.HasExited) throw new InvalidOperationException("회의록 서버가 시작되지 않았습니다.");
                if (count >= 200) throw new TimeoutException("회의록 서버 준비 시간이 초과됐습니다.");
                await Task.Delay(100);
            }
            var ready = json.Deserialize<Ready>(File.ReadAllText(readyFile));
            origin = new Uri(ready.url);
            if (origin.Scheme != "http" || origin.Host != "127.0.0.1" || ready.pid != server.Id || origin.Fragment.Length < 20)
                throw new InvalidOperationException("회의록 실행 주소를 확인하지 못했습니다.");
            var options = new CoreWebView2EnvironmentOptions();
            if (selfTest) options.AdditionalBrowserArguments = "--use-fake-device-for-media-stream --use-fake-ui-for-media-stream";
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataRoot, "화면캐시"), options);
            if (closing) return;
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { e.Cancel = !IsLocal(e.Uri); };
            view.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            view.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e)
            {
                e.SavesInProfile = false;
                if (!IsLocal(e.Uri) || e.PermissionKind != CoreWebView2PermissionKind.Microphone)
                    e.State = CoreWebView2PermissionState.Deny;
                else if (selfTest) e.State = CoreWebView2PermissionState.Allow;
            };
            view.CoreWebView2.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e)
            {
                if (!IsLocal(e.Source)) return;
                if (e.TryGetWebMessageAsString() == "open-data-folder" && !selfTest)
                {
                    Directory.CreateDirectory(Path.Combine(dataRoot, "회의자료"));
                    Process.Start(new ProcessStartInfo("explorer.exe", Quote(Path.Combine(dataRoot, "회의자료"))) { UseShellExecute = true });
                }
            };
            view.CoreWebView2.WindowCloseRequested += delegate { allowClose = true; Close(); };
            view.CoreWebView2.ProcessFailed += delegate { if (!closing) { loading.Text = "화면이 중단되었습니다. 저장한 회의 자료는 유지됩니다. 프로그램을 다시 실행해 주세요."; loading.Visible = true; loading.BringToFront(); } };
            var loaded = new TaskCompletionSource<bool>();
            view.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (e.IsSuccess) { loading.Visible = false; loaded.TrySetResult(true); }
                else loaded.TrySetException(new InvalidOperationException("회의록 화면을 불러오지 못했습니다."));
            };
            view.CoreWebView2.Navigate(ready.url);
            if (await Task.WhenAny(loaded.Task, Task.Delay(20000)) != loaded.Task) throw new TimeoutException("화면 준비 시간 초과");
            await loaded.Task;
            if (selfTest) await RunSelfTest();
        }
        catch (Exception error)
        {
            ExitCode = 1;
            File.WriteAllText(Path.Combine(dataRoot, "실행오류.txt"), DateTime.Now.ToString("s") + "\r\n" + error);
            if (!selfTest) MessageBox.Show(this, "VoiceNote를 시작하지 못했습니다.\r\n" + error.Message + "\r\nWebView2 설치와 보안 프로그램의 실행 제한을 확인해 주세요.", Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { if (selfTest || ExitCode != 0) { allowClose = true; Close(); } }
    }

    private async Task RunSelfTest()
    {
        string result = null;
        for (int count = 0; count < 100; count++)
        {
            result = await view.CoreWebView2.ExecuteScriptAsync("JSON.stringify({presets:document.querySelectorAll('#project-presets button').length, status:typeof window.meetingDesktopStatus==='function', title:document.title})");
            if (result.Contains("presets\\\":9")) break;
            await Task.Delay(100);
        }
        var decoded = json.Deserialize<string>(result);
        var state = json.Deserialize<Smoke>(decoded);
        if (state.presets != 9 || !state.status) throw new InvalidOperationException("프로젝트 화면 검증 실패: " + decoded);
        await view.CoreWebView2.ExecuteScriptAsync("window.__audioCheck='pending'; (async()=>{try{const s=await navigator.mediaDevices.getUserMedia({audio:true});const r=new MediaRecorder(s);const parts=[];r.ondataavailable=e=>parts.push(e.data);r.onstop=()=>{s.getTracks().forEach(t=>t.stop());window.__audioCheck=new Blob(parts).size>0?'pass':'empty';};r.start();setTimeout(()=>r.stop(),700);}catch(e){window.__audioCheck=String(e);}})();");
        string audioResult = "";
        for (int count = 0; count < 100; count++)
        {
            audioResult = await view.CoreWebView2.ExecuteScriptAsync("window.__audioCheck");
            if (audioResult != "\"pending\"") break;
            await Task.Delay(100);
        }
        if (audioResult != "\"pass\"") throw new InvalidOperationException("가상 마이크 검증 실패: " + audioResult);
        File.WriteAllText(Path.Combine(dataRoot, "화면검증.json"), "{\"passed\":true,\"virtualMicrophone\":true,\"page\":" + decoded + "}");
    }

    private async void OnClosing(object sender, FormClosingEventArgs e)
    {
        if (allowClose || selfTest) return;
        if (view.CoreWebView2 == null) return;
        e.Cancel = true;
        if (checkingClose) return;
        checkingClose = true;
        try
        {
            var result = await view.CoreWebView2.ExecuteScriptAsync("typeof window.meetingDesktopStatus==='function' ? window.meetingDesktopStatus() : {unsaved:true}");
            var status = json.Deserialize<CloseStatus>(result);
            if (status == null || status.unsaved)
            {
                if (MessageBox.Show(this, "녹음·분석 중이거나 저장되지 않은 내용이 있습니다.\r\n종료하면 진행 중인 작업과 미저장 음성을 잃을 수 있습니다. 종료할까요?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            }
            allowClose = true;
            Close();
        }
        catch { if (MessageBox.Show(this, "화면 상태를 확인하지 못했습니다. 프로그램을 종료할까요?", Text, MessageBoxButtons.YesNo) == DialogResult.Yes) { allowClose = true; Close(); } }
        finally { checkingClose = false; }
    }

    private bool IsLocal(string value)
    {
        Uri candidate;
        return Uri.TryCreate(value, UriKind.Absolute, out candidate) && candidate.Scheme == origin.Scheme && candidate.Host == origin.Host && candidate.Port == origin.Port;
    }
    private static string Quote(string value) { return "\"" + value.TrimEnd('\\') + "\""; }
    private void StopServer()
    {
        try { if (server != null && !server.HasExited) { server.Kill(); server.WaitForExit(3000); } } catch { }
        try { if (readyFile != null && File.Exists(readyFile)) File.Delete(readyFile); } catch { }
    }
    private sealed class Ready { public string url { get; set; } public int pid { get; set; } }
    private sealed class Smoke { public int presets { get; set; } public bool status { get; set; } }
    private sealed class CloseStatus { public bool unsaved { get; set; } }
}
