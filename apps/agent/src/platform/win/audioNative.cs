// COM de audio de Windows (core audio) para el hijo de audio (docs/PLAN.md 8.4.4). Se compila una vez con Add-Type en
// Windows PowerShell 5.1, así que es C# 5: sin `?.`, sin `$"..."`, sin `out var`. Devuelve JSON armado a mano.
// Todo lo que recibe son ids de Windows que el agente sacó de su último snapshot: nada llega del celu sin pasar por el agente.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace ProyectoE {
  [StructLayout(LayoutKind.Sequential)] public struct PROPERTYKEY { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit)] public struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); int OpenPropertyStore(int access, out IPropertyStore ps); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); int GetState(out int s); }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection { int GetCount(out int c); int Item(int i, out IMMDevice d); }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d); }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator { }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume { int f1(); int f2(); int GetChannelCount(out int c); int SetMasterVolumeLevel(float l, ref Guid g); int SetMasterVolumeLevelScalar(float l, ref Guid g); int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l); int f8(); int f9(); int f10(); int f11(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m); }
  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioMeterInformation { int GetPeakValue(out float p); }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionManager2 { int f1(); int f2(); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i, out IAudioSessionControl2 s); }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionControl2 {
    int GetState(out int s); int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n); int f3(); int f4(); int f5(); int f6(); int f7(); int f8(); int f9();
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s); int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s); int GetProcessId(out uint pid); int IsSystemSoundsSession();
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ISimpleAudioVolume { int SetMasterVolume(float l, ref Guid g); int GetMasterVolume(out float l); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m); }

  public static class AudioNative {
    const int eRender = 0, eMultimedia = 1, DEVICE_STATE_ACTIVE = 1, CLSCTX_ALL = 23;
    // Contexto propio en cada Set...: así el cambio no rebota como si lo hubiera hecho otra app (D31).
    static Guid Ctx = new Guid("5d3f1d6a-8c2b-4f6e-9a11-6b2f0c0e4a10");
    static readonly Guid IID_Volume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    static readonly Guid IID_Meter = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
    static readonly Guid IID_Sessions = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageNameW(IntPtr h, int flags, StringBuilder name, ref int size);

    // ── JSON a mano ──
    static string Q(string s) {
      if (s == null) return "null";
      StringBuilder b = new StringBuilder("\"");
      foreach (char c in s) {
        if (c == '"') b.Append("\\\""); else if (c == '\\') b.Append("\\\\");
        else if (c < 32 || c > 126) b.Append("\\u").Append(((int)c).ToString("x4"));
        else b.Append(c);
      }
      return b.Append('"').ToString();
    }
    static string N(double d) { return d.ToString("0.####", CultureInfo.InvariantCulture); }
    static string B(bool v) { return v ? "true" : "false"; }

    static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)new MMDeviceEnumerator(); }
    static T Activate<T>(IMMDevice d, Guid iid) { object o; Marshal.ThrowExceptionForHR(d.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o)); return (T)o; }

    static string Prop(IMMDevice d, Guid fmt, int pid, out int asInt) {
      IPropertyStore ps; d.OpenPropertyStore(0, out ps);
      PROPERTYKEY k = new PROPERTYKEY(); k.fmtid = fmt; k.pid = pid;
      PROPVARIANT v; ps.GetValue(ref k, out v);
      string s = null; asInt = 0;
      if (v.vt == 31) s = Marshal.PtrToStringUni(v.p);          // VT_LPWSTR
      else if (v.vt == 19) asInt = (int)v.p.ToInt64();          // VT_UI4
      PropVariantClear(ref v);
      Marshal.ReleaseComObject(ps);
      return s;
    }

    static string ExePath(int pid) {
      if (pid <= 0) return "";
      IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
      if (h == IntPtr.Zero) return "";
      try { StringBuilder sb = new StringBuilder(1024); int size = sb.Capacity; return QueryFullProcessImageNameW(h, 0, sb, ref size) ? sb.ToString() : ""; }
      finally { CloseHandle(h); }
    }

    static IMMDevice Device(string winId) {
      IMMDevice d;
      int hr; try { hr = Enumerator().GetDevice(winId, out d); } catch (Exception) { throw new InvalidOperationException("not_found"); }
      if (hr != 0 || d == null) throw new InvalidOperationException("not_found");
      return d;
    }

    static void CheckActive(IMMDevice d) { int st; d.GetState(out st); if (st != DEVICE_STATE_ACTIVE) throw new InvalidOperationException("output_unavailable"); }

    /// <summary>Salidas activas, sesiones por app y la predeterminada, como JSON (sin la parte de media, que es WinRT).</summary>
    public static string Snapshot() {
      IMMDeviceEnumerator en = Enumerator();
      string defId = null; IMMDevice def;
      if (en.GetDefaultAudioEndpoint(eRender, eMultimedia, out def) == 0) def.GetId(out defId);
      IMMDeviceCollection col; Marshal.ThrowExceptionForHR(en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out col));
      int n; col.GetCount(out n);
      List<string> outs = new List<string>(), sess = new List<string>();
      Guid fmtName = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), fmtForm = new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e");
      for (int i = 0; i < n; i++) {
        try {
        IMMDevice d; col.Item(i, out d); string id; d.GetId(out id);
        int dummy, form; string name = Prop(d, fmtName, 14, out dummy); Prop(d, fmtForm, 0, out form);
        IAudioEndpointVolume ev = Activate<IAudioEndpointVolume>(d, IID_Volume);
        float vol; bool mute; ev.GetMasterVolumeLevelScalar(out vol); ev.GetMute(out mute);
        outs.Add("{\"winId\":" + Q(id) + ",\"name\":" + Q(name) + ",\"formFactor\":" + form + ",\"volume\":" + N(vol) + ",\"muted\":" + B(mute) + "}");
        IAudioSessionManager2 sm = Activate<IAudioSessionManager2>(d, IID_Sessions);
        IAudioSessionEnumerator se; sm.GetSessionEnumerator(out se); int sc; se.GetCount(out sc);
        for (int j = 0; j < sc; j++) {
          IAudioSessionControl2 s = null;
          try {
          se.GetSession(j, out s);
          uint pid; s.GetProcessId(out pid);
          ISimpleAudioVolume sv = (ISimpleAudioVolume)s; float v2; bool m2; sv.GetMasterVolume(out v2); sv.GetMute(out m2);
          float pk; ((IAudioMeterInformation)s).GetPeakValue(out pk);
          sess.Add("{\"pid\":" + pid + ",\"exePath\":" + Q(ExePath((int)pid)) + ",\"winOutputId\":" + Q(id) + ",\"volume\":" + N(v2) + ",\"muted\":" + B(m2) + ",\"peak\":" + N(pk) + ",\"routedWinId\":" + Q(AudioPolicy.RoutedOf((int)pid)) + "}");
          } catch (Exception) { /* una sesión que se cerró a mitad de la lectura: se saltea */ }
          finally { if (s != null) Marshal.ReleaseComObject(s); }
        }
        } catch (Exception) { /* una salida que cambió de estado a mitad de la lectura (la tele): se saltea hasta el próximo ciclo */ }
      }
      return "{\"outputs\":[" + string.Join(",", outs.ToArray()) + "],\"sessions\":[" + string.Join(",", sess.ToArray()) + "],\"defaultWinId\":" + Q(defId) + "}";
    }

    /// <summary>La salida predeterminada de un rol (0 Consola, 1 Multimedia, 2 Comunicaciones), o null.</summary>
    public static string DefaultOf(int role) {
      IMMDevice d; if (Enumerator().GetDefaultAudioEndpoint(eRender, role, out d) != 0 || d == null) return null;
      string id; d.GetId(out id); return id;
    }

    public static void SetOutputVolume(string winId, double scalar) {
      IMMDevice d = Device(winId); CheckActive(d);
      Marshal.ThrowExceptionForHR(Activate<IAudioEndpointVolume>(d, IID_Volume).SetMasterVolumeLevelScalar((float)scalar, ref Ctx));
    }
    public static void SetOutputMute(string winId, bool muted) {
      IMMDevice d = Device(winId); CheckActive(d);
      Marshal.ThrowExceptionForHR(Activate<IAudioEndpointVolume>(d, IID_Volume).SetMute(muted, ref Ctx));
    }

    /// <summary>Aplica `act` a cada sesión de esos procesos, en todas las salidas activas. Devuelve cuántas tocó.</summary>
    static int EachSession(int[] pids, Action<ISimpleAudioVolume> act) {
      HashSet<int> want = new HashSet<int>(pids); int touched = 0;
      IMMDeviceCollection col; Enumerator().EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out col);
      int n; col.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IMMDevice d; col.Item(i, out d);
        IAudioSessionEnumerator se; Activate<IAudioSessionManager2>(d, IID_Sessions).GetSessionEnumerator(out se);
        int sc; se.GetCount(out sc);
        for (int j = 0; j < sc; j++) {
          IAudioSessionControl2 s; se.GetSession(j, out s); uint pid; s.GetProcessId(out pid);
          if (want.Contains((int)pid)) { act((ISimpleAudioVolume)s); touched++; }
        }
      }
      return touched;
    }
    public static int SetAppVolume(int[] pids, double scalar) { return EachSession(pids, delegate(ISimpleAudioVolume v) { v.SetMasterVolume((float)scalar, ref Ctx); }); }
    public static int SetAppMute(int[] pids, bool muted) { return EachSession(pids, delegate(ISimpleAudioVolume v) { v.SetMute(muted, ref Ctx); }); }
  }
  // ── Funciones NO documentadas de Windows (D29 y D30). Aisladas acá: si una actualización las rompe, la clase se apaga
  //    (Probe devuelve false) y el resto del audio sigue andando. ──
  [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPolicyConfig {
    int u1(); int u2(); int u3(); int u4(); int u5(); int u6(); int u7(); int u8();
    int GetPropertyValue(IntPtr id, IntPtr key, IntPtr pv);
    int SetPropertyValue(IntPtr id, IntPtr key, IntPtr pv);
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  }

  // Mismo orden en la variante de Windows 10 y en la de 21H2; solo cambia el IID. NO se declara ClearAllPersistedApplicationDefaultEndpoints
  // a propósito: así no hay forma de borrar lo que Jay configuró en Windows.
  [ComImport, Guid("ab3d4648-e242-459f-b02f-541c70306324"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
  public interface IPolicyFactory21H2 {
    int m1(); int m2(); int m3(); int m4(); int m5(); int m6(); int m7(); int m8(); int m9(); int m10(); int m11(); int m12(); int m13(); int m14(); int m15(); int m16(); int m17(); int m18(); int m19();
    [PreserveSig] int SetPersistedDefaultAudioEndpoint(uint pid, int flow, int role, IntPtr hstr);
    [PreserveSig] int GetPersistedDefaultAudioEndpoint(uint pid, int flow, int role, out IntPtr hstr);
  }
  [ComImport, Guid("2a59116d-6c4f-45e0-a74f-707e3fef9258"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
  public interface IPolicyFactoryDownlevel {
    int m1(); int m2(); int m3(); int m4(); int m5(); int m6(); int m7(); int m8(); int m9(); int m10(); int m11(); int m12(); int m13(); int m14(); int m15(); int m16(); int m17(); int m18(); int m19();
    [PreserveSig] int SetPersistedDefaultAudioEndpoint(uint pid, int flow, int role, IntPtr hstr);
    [PreserveSig] int GetPersistedDefaultAudioEndpoint(uint pid, int flow, int role, out IntPtr hstr);
  }

  public static class AudioPolicy {
    const int eRender = 0;
    const string Prefix = "\\\\?\\SWD#MMDEVAPI#";
    const string RenderSuffix = "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
    [DllImport("combase.dll")] static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string s, int len, out IntPtr h);
    [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr h);
    [DllImport("combase.dll")] static extern IntPtr WindowsGetStringRawBuffer(IntPtr h, out int len);
    [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);

    static object policyConfig;     // IPolicyConfig
    static object factory;          // IPolicyFactory21H2 o IPolicyFactoryDownlevel
    static bool factoryIs21H2;
    public static string FactoryKind = "none";

    /// <summary>Intenta crear las dos cosas. Nunca tira: cada una dice si anda en esta PC.</summary>
    public static bool[] Probe() {
      bool def = false, route = false;
      try { policyConfig = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9"))); def = policyConfig is IPolicyConfig; } catch (Exception) { policyConfig = null; }
      IntPtr cls = IntPtr.Zero;
      try {
        if (WindowsCreateString("Windows.Media.Internal.AudioPolicyConfig", 40, out cls) == 0) {
          foreach (string which in new string[] { "21H2", "Downlevel" }) {
            Guid iid = which == "21H2" ? typeof(IPolicyFactory21H2).GUID : typeof(IPolicyFactoryDownlevel).GUID;
            IntPtr f; if (RoGetActivationFactory(cls, ref iid, out f) != 0 || f == IntPtr.Zero) continue;
            object o = Marshal.GetObjectForIUnknown(f); Marshal.Release(f);
            if (which == "21H2" && o is IPolicyFactory21H2) { factory = o; factoryIs21H2 = true; FactoryKind = which; route = true; break; }
            if (which == "Downlevel" && o is IPolicyFactoryDownlevel) { factory = o; factoryIs21H2 = false; FactoryKind = which; route = true; break; }
          }
        }
      } catch (Exception) { factory = null; route = false; }
      finally { if (cls != IntPtr.Zero) WindowsDeleteString(cls); }
      return new bool[] { def, route };
    }

    /// <summary>Hace predeterminada la salida en Multimedia y Consola. Comunicaciones NO se toca: es el rol de las llamadas y suele ir en el headset (D29).</summary>
    public static void SetDefault(string winId) {
      IPolicyConfig pc = policyConfig as IPolicyConfig; if (pc == null) throw new InvalidOperationException("unsupported");
      foreach (int role in new int[] { 1, 0 }) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(winId, role));
    }

    /// <summary>Un solo rol (0 Consola, 1 Multimedia, 2 Comunicaciones): para devolver cada uno a como estaba.</summary>
    public static void SetDefaultRole(string winId, int role) {
      IPolicyConfig pc = policyConfig as IPolicyConfig; if (pc == null) throw new InvalidOperationException("unsupported");
      Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(winId, role));
    }

    static string Wrap(string winId) { return Prefix + winId + RenderSuffix; }
    public static string Unwrap(string s) {
      if (string.IsNullOrEmpty(s)) return null;
      if (s.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) s = s.Substring(Prefix.Length);
      int i = s.LastIndexOf('#'); if (i > 0) s = s.Substring(0, i);
      return s;
    }

    static int SetPersisted(uint pid, int role, IntPtr h) { return factoryIs21H2 ? ((IPolicyFactory21H2)factory).SetPersistedDefaultAudioEndpoint(pid, eRender, role, h) : ((IPolicyFactoryDownlevel)factory).SetPersistedDefaultAudioEndpoint(pid, eRender, role, h); }
    static int GetPersisted(uint pid, int role, out IntPtr h) { return factoryIs21H2 ? ((IPolicyFactory21H2)factory).GetPersistedDefaultAudioEndpoint(pid, eRender, role, out h) : ((IPolicyFactoryDownlevel)factory).GetPersistedDefaultAudioEndpoint(pid, eRender, role, out h); }

    /// <summary>
    /// Manda el proceso a una salida (Multimedia y después Consola, ese orden); null = que vuelva a seguir a la predeterminada (D30).
    /// Verificado en la PC de Jay (S2, 07/11/2026): con las 3 salidas de destino. Desfijar un proceso que ya no estaba fijado devuelve
    /// E_INVALIDARG, y una vez falló con E_NOTIMPL: por eso, si falla pero el proceso ya no está fijado, cuenta como éxito.
    /// </summary>
    public static void Route(int pid, string winIdOrNull) {
      if (factory == null) throw new InvalidOperationException("unsupported");
      // PowerShell convierte $null en "" al llamar un método con `string`: "" también significa "desfijar".
      if (winIdOrNull != null && winIdOrNull.Length == 0) winIdOrNull = null;
      IntPtr h = IntPtr.Zero;
      try {
        if (winIdOrNull != null) { string w = Wrap(winIdOrNull); Marshal.ThrowExceptionForHR(WindowsCreateString(w, w.Length, out h)); }
        int firstFailure = 0;
        foreach (int role in new int[] { 1, 0 }) { int hr = SetPersisted((uint)pid, role, h); if (hr != 0 && firstFailure == 0) firstFailure = hr; }
        if (firstFailure == 0) return;
        if (winIdOrNull == null && RoutedOf(pid) == null) return;
        Marshal.ThrowExceptionForHR(firstFailure);
      } finally { if (h != IntPtr.Zero) WindowsDeleteString(h); }
    }

    /// <summary>A qué salida fijó Windows este proceso (id de Windows) o null si sigue a la predeterminada.</summary>
    public static string RoutedOf(int pid) {
      if (factory == null || pid <= 0) return null;
      IntPtr h = IntPtr.Zero;
      try {
        if (GetPersisted((uint)pid, 0, out h) != 0 || h == IntPtr.Zero) return null;
        int len; IntPtr buf = WindowsGetStringRawBuffer(h, out len);
        return len == 0 ? null : Unwrap(Marshal.PtrToStringUni(buf, len));
      } catch (Exception) { return null; }
      finally { if (h != IntPtr.Zero) WindowsDeleteString(h); }
    }
  }
}
