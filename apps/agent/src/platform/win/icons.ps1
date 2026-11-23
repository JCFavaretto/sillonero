# Saca íconos de 96x96 con IShellItemImageFactory.GetImage (SIIGBF_ICONONLY) y los deja como <key>.b64 (PNG en base64).
# -OutDir: carpeta de salida. -ItemsB64: JSON en base64 con [{ key, parsing }]; `parsing` lo arma el agente
# (shell:AppsFolder\<AppID> o la ruta de un .exe), nunca el celu. Los que fallan quedan sin archivo.
param([Parameter(Mandatory = $true)][string]$OutDir, [Parameter(Mandatory = $true)][string]$ItemsB64)
$ErrorActionPreference = "Stop"
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.IO; using System.Runtime.InteropServices; using System.Drawing; using System.Drawing.Imaging;
[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
[StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx; public int cy; }
public static class Ico {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory f);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  public static string Png(string parsing, int px) {
    IShellItemImageFactory f; SHCreateItemFromParsingName(parsing, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f);
    IntPtr h; int hr = f.GetImage(new SIZE{cx=px,cy=px}, 0x4, out h); if (hr != 0) throw new Exception("hr " + hr);
    try {
      using (var bmp = Image.FromHbitmap(h)) {
        var bd = bmp.LockBits(new Rectangle(0,0,bmp.Width,bmp.Height), ImageLockMode.ReadOnly, bmp.PixelFormat);
        try {
          using (var argb = new Bitmap(bmp.Width, bmp.Height, bd.Stride, PixelFormat.Format32bppArgb, bd.Scan0))
          using (var ms = new MemoryStream()) { argb.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
        } finally { bmp.UnlockBits(bd); }
      }
    } finally { DeleteObject(h); }
  }
}
"@
$items = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ItemsB64)) | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
foreach ($it in $items) {
  if ($it.key -notmatch '^i_[A-Za-z0-9_-]{16}$') { continue }
  try { [IO.File]::WriteAllText((Join-Path $OutDir ($it.key + ".b64")), [Ico]::Png([string]$it.parsing, 96)) } catch { }
}
