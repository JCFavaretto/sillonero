# Hijo de audio del agente (docs/PLAN.md 8.4.4, D27). Windows PowerShell 5.1, vive mientras corre el agente.
# Compila audioNative.cs una vez, avisa {"ready":true,...} y atiende UN pedido JSON por línea de stdin:
#   {"id":1,"op":"snapshot"}  ->  {"id":1,"ok":true,"result":{...}}  |  {"id":1,"ok":false,"error":"..."}
# Todo lo que recibe son ids de Windows que el agente sacó de su último snapshot. Si stdin se cierra, termina.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$script:media = $true
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  Add-Type -AssemblyName System.Drawing
} catch { $script:media = $false }
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'audioNative.cs'), [Text.Encoding]::UTF8))

$mgr = $null
try {
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@([Windows.Storage.Streams.IInputStream]))

function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'timeout' }
  $task.Result
}
function Emit([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Js($v) { ConvertTo-Json -InputObject $v -Compress }

$SessionManager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($SessionManager::RequestAsync()) $SessionManager
} catch { $script:media = $false; $mgr = $null }

function Find-MediaSession([string]$aumid, [int]$index) {
  if ($null -eq $mgr) { throw 'unsupported' }
  # Varias sesiones pueden compartir AUMID (YouTube y YouTube Music en Chrome): se elige por número de orden entre las del mismo AUMID.
  $n = 0
  foreach ($s in $mgr.GetSessions()) {
    if ($s.SourceAppUserModelId -eq $aumid) { if ($n -eq $index) { return $s }; $n++ }
  }
  throw 'not_found'
}

function Get-MediaJson {
  if ($null -eq $mgr) { return '[]' }
  $cur = $mgr.GetCurrentSession()
  $curId = if ($cur) { $cur.SourceAppUserModelId } else { '' }
  $items = @()
  $seen = @{}
  foreach ($s in $mgr.GetSessions()) {
    $ix = 0
    if ($seen.ContainsKey([string]$s.SourceAppUserModelId)) { $ix = $seen[[string]$s.SourceAppUserModelId] }
    $seen[[string]$s.SourceAppUserModelId] = $ix + 1
    try {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $PropsType
      $pb = $s.GetPlaybackInfo()
      $c = $pb.Controls
      $status = switch ([string]$pb.PlaybackStatus) { 'Playing' { 'playing' } 'Paused' { 'paused' } default { 'other' } }
      # D97: por dónde va. La posición vale para LastUpdatedTime; `ageMs` es cuánto hace de eso (null si la app nunca lo dijo).
      $timeline = $null
      try {
        $tl = $s.GetTimelineProperties()
        if ($tl) {
          $age = $null
          if ($tl.LastUpdatedTime.Year -ge 2000) { $age = [long][math]::Round(([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalMilliseconds) }
          $rate = $null
          if ($null -ne $pb.PlaybackRate) { $rate = [double]$pb.PlaybackRate }
          $timeline = [ordered]@{
            startMs = [long][math]::Round($tl.StartTime.TotalMilliseconds); endMs = [long][math]::Round($tl.EndTime.TotalMilliseconds)
            positionMs = [long][math]::Round($tl.Position.TotalMilliseconds); ageMs = $age; rate = $rate
          }
        }
      } catch { $timeline = $null }   # una app que no la informa: sin barra, el resto sigue
      $items += [ordered]@{
        aumid = [string]$s.SourceAppUserModelId; index = $ix; title = [string]$p.Title; artist = [string]$p.Artist; status = $status
        controls = [ordered]@{ prev = [bool]$c.IsPreviousEnabled; playPause = [bool]$c.IsPlayPauseToggleEnabled; next = [bool]$c.IsNextEnabled }
        hasArt = ($null -ne $p.Thumbnail); isCurrent = ($s.SourceAppUserModelId -eq $curId); timeline = $timeline
      }
    } catch { }   # una sesión que se cerró mientras se leía: se saltea
  }
  Js @($items)
}

# F4a: los reproductores de sonidos en curso. Los que terminaron (o llevan 2 minutos) se liberan en el próximo pedido.
$script:sounds = New-Object System.Collections.ArrayList
$script:renderSel = $null
try {
  $null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
  $null = [Windows.Media.Devices.MediaDevice, Windows.Media.Devices, ContentType = WindowsRuntime]
  $null = [Windows.Media.Playback.MediaPlayer, Windows.Media.Playback, ContentType = WindowsRuntime]
  $null = [Windows.Media.Core.MediaSource, Windows.Media.Core, ContentType = WindowsRuntime]
  $script:renderSel = [Windows.Media.Devices.MediaDevice]::GetAudioRenderSelector()
} catch { $script:renderSel = $null }
function Release-Sounds {
  for ($i = $script:sounds.Count - 1; $i -ge 0; $i--) {
    $s = $script:sounds[$i]
    $state = [string]$s.Player.PlaybackSession.PlaybackState
    $age = [Environment]::TickCount - $s.At
    if (($state -ne 'Playing' -and $state -ne 'Opening' -and $state -ne 'Buffering' -and $age -gt 1500) -or $age -gt 120000 -or $age -lt 0) {
      try { $s.Player.Dispose() } catch { }
      $script:sounds.RemoveAt($i)
    }
  }
}

function Get-ArtJson([string]$aumid, [int]$index) {
  $s = Find-MediaSession $aumid $index
  $p = Await ($s.TryGetMediaPropertiesAsync()) $PropsType
  if (-not $p.Thumbnail) { return 'null' }
  $ras = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  # La imagen la elige la app (o la página web): se descarta antes de decodificar si es enorme.
  if ($ras.Size -gt 5242880) { return 'null' }
  $stream = $asRead.Invoke($null, @($ras))
  $img = $null; $bmp = $null; $ms = $null
  try {
    $img = [System.Drawing.Image]::FromStream($stream, $false, $false)
    if ($img.Width -gt 4096 -or $img.Height -gt 4096) { return 'null' }
    $scale = 200.0 / [Math]::Max($img.Width, $img.Height)
    $w = [Math]::Max(1, [int][Math]::Round($img.Width * [Math]::Min(1.0, $scale)))
    $h = [Math]::Max(1, [int][Math]::Round($img.Height * [Math]::Min(1.0, $scale)))
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    foreach ($q in 80, 60) {
      $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
      $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$q)
      if ($ms) { $ms.Dispose() }
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, $enc, $ep)
      if ($ms.Length -le 16384) { return (Js ([Convert]::ToBase64String($ms.ToArray()))) }
    }
    return 'null'   # pesa de más: sin carátula (D34)
  } finally {
    if ($ms) { $ms.Dispose() }
    if ($bmp) { $bmp.Dispose() }
    if ($img) { $img.Dispose() }
    $stream.Dispose()
  }
}

function Invoke-Op([string]$op, $a) {
  switch ($op) {
    'snapshot' {
      $audio = [ProyectoE.AudioNative]::Snapshot()
      return $audio.Substring(0, $audio.Length - 1) + ',"media":' + (Get-MediaJson) + '}'
    }
    'setOutputVolume' { [ProyectoE.AudioNative]::SetOutputVolume([string]$a.winId, [double]$a.scalar); return 'null' }
    'setOutputMute' { [ProyectoE.AudioNative]::SetOutputMute([string]$a.winId, [bool]$a.muted); return 'null' }
    'setAppVolume' { if ([ProyectoE.AudioNative]::SetAppVolume([int[]]@($a.pids), [double]$a.scalar) -eq 0) { throw 'not_found' }; return 'null' }
    'setAppMute' { if ([ProyectoE.AudioNative]::SetAppMute([int[]]@($a.pids), [bool]$a.muted) -eq 0) { throw 'not_found' }; return 'null' }
    'mediaControl' {
      $s = Find-MediaSession ([string]$a.aumid) ([int]$a.index)
      $c = $s.GetPlaybackInfo().Controls
      $ok = switch ([string]$a.key) {
        'prev' { if (-not $c.IsPreviousEnabled) { throw 'not_supported' }; Await ($s.TrySkipPreviousAsync()) ([bool]) }
        'next' { if (-not $c.IsNextEnabled) { throw 'not_supported' }; Await ($s.TrySkipNextAsync()) ([bool]) }
        'playPause' { if (-not $c.IsPlayPauseToggleEnabled) { throw 'not_supported' }; Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
        default { throw 'bad_key' }
      }
      if (-not $ok) { throw 'failed' }
      return 'null'
    }
    'art' { return (Get-ArtJson ([string]$a.aumid) ([int]$a.index)) }
    'setDefault' { if (-not $script:policy[0]) { throw 'unsupported' }; [ProyectoE.AudioPolicy]::SetDefault([string]$a.winId); return 'null' }
    'playSound' {
      # F4a (D108): un archivo por una salida elegida, sin tocar la predeterminada. Vuelve enseguida; el reproductor se libera solo.
      if ($null -eq $script:renderSel) { throw 'unsupported' }
      Release-Sounds
      $all = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($script:renderSel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
      $dev = $all | Where-Object { $_.Id -like ('*' + [string]$a.winId + '*') } | Select-Object -First 1
      if ($null -eq $dev) { throw 'output_unavailable' }
      if ($script:sounds.Count -ge 8) { $old = $script:sounds[0]; $script:sounds.RemoveAt(0); try { $old.Player.Dispose() } catch { } }
      # Solo un archivo de una unidad local: nunca una dirección de red (SMB filtraría el hash NTLM) ni un http://.
      $uri = [Uri]([string]$a.file)
      if (-not $uri.IsFile -or $uri.IsUnc) { throw 'failed' }
      $p = New-Object Windows.Media.Playback.MediaPlayer
      try {
        $p.AudioDevice = $dev
        $p.Volume = [double]$a.volume
        $p.Source = [Windows.Media.Core.MediaSource]::CreateFromUri($uri)
        $p.Play()
      } catch { try { $p.Dispose() } catch { }; throw }
      $script:sounds.Add([pscustomobject]@{ Player = $p; At = [Environment]::TickCount }) | Out-Null
      return 'null'
    }
    'route' {
      if (-not $script:policy[1]) { throw 'unsupported' }
      $winId = if ($null -eq $a.winId) { $null } else { [string]$a.winId }
      foreach ($procId in [int[]]@($a.pids)) { [ProyectoE.AudioPolicy]::Route($procId, $winId) }
      return 'null'
    }
    default { throw "unknown_op" }
  }
}

# Funciones no documentadas (D29, D30): cada una se anuncia como disponible solo si en esta PC se pudo crear (S2: andan en Windows 10 19045).
$script:policy = [ProyectoE.AudioPolicy]::Probe()
$build = [Environment]::OSVersion.Version.Build
Emit ('{"ready":true,"build":' + $build + ',"factory":"' + [ProyectoE.AudioPolicy]::FactoryKind + '","media":' + $script:media.ToString().ToLower() + ',"defaultOutput":' + $script:policy[0].ToString().ToLower() + ',"appRouting":' + $script:policy[1].ToString().ToLower() + '}')

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $id = -1
  try {
    $req = $line | ConvertFrom-Json
    $id = [int]$req.id
    $result = Invoke-Op ([string]$req.op) $req.args
    Emit ('{"id":' + $id + ',"ok":true,"result":' + $result + '}')
  } catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    Emit ('{"id":' + $id + ',"ok":false,"error":' + (Js ([string]$e.Message)) + '}')
  }
}
