# Identificar pantallas: muestra un número grande arriba a la izquierda de cada pantalla durante unos segundos.
# Lo lanza el agente (platform/win/identify.ts) con enteros que arma él mismo; no recibe texto de nadie más.
#   -Items   "indice,x,y,ancho,alto;indice,x,y,ancho,alto"   (píxeles físicos, coordenadas del escritorio)
#   -Seconds cuánto tiempo quedan en pantalla
param(
  [Parameter(Mandatory = $true)][string]$Items,
  [int]$Seconds = 2
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# Per-monitor v2 (-4): así las posiciones son píxeles físicos, iguales a las que leyó el agente.
Add-Type -Namespace Native -Name Dpi -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);'
[void][Native.Dpi]::SetProcessDpiAwarenessContext([System.IntPtr]::new(-4))

$forms = @()
foreach ($item in $Items.Split(';')) {
  $p = $item.Split(',')
  if ($p.Count -ne 5) { continue }
  $n = [int]$p[0]; $x = [int]$p[1]; $y = [int]$p[2]

  $f = New-Object System.Windows.Forms.Form
  $f.FormBorderStyle = 'None'
  $f.StartPosition = 'Manual'
  $f.ShowInTaskbar = $false
  $f.TopMost = $true
  $f.BackColor = [System.Drawing.Color]::FromArgb(59, 111, 224)
  $f.Size = New-Object System.Drawing.Size(240, 220)
  $f.Location = New-Object System.Drawing.Point(($x + 40), ($y + 40))

  $l = New-Object System.Windows.Forms.Label
  $l.Dock = 'Fill'
  $l.Text = "$n"
  $l.ForeColor = [System.Drawing.Color]::White
  $l.TextAlign = 'MiddleCenter'
  $l.Font = New-Object System.Drawing.Font('Segoe UI', 96, [System.Drawing.FontStyle]::Bold)
  $f.Controls.Add($l)

  # Sin robar el foco: se muestra sin activar la ventana.
  $f.Show()
  $forms += $f
}

$until = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $until) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 30
}
foreach ($f in $forms) { $f.Close(); $f.Dispose() }
