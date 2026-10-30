# nowplaying.ps1 (dsh-music-companion)
# Reads the Windows System Media Transport Controls session (QQ Music, NetEase, Spotify, browsers...).
# Prints one compact JSON line per poll so the host half can decide what to do.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File nowplaying.ps1 -Interval 3
#
# Output shape (one line per poll):
#   {"title":"...","artist":"...","album":"...","status":"Playing","position":12.3,"duration":223.9,"app":"QQMusic.exe"}
#   {}  when nothing is playing / no session.
param(
    [int]$Interval = 3,
    [switch]$Once,
    [string]$AppMatch = 'QQMusic'
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

function Await($op, $resultType) {
    if ($null -eq $op) { return $null }
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]

function Read-Current {
    try {
        $mgr = Await ($mgrType::RequestAsync()) $mgrType
        $sessions = @($mgr.GetSessions())
        if ($sessions.Count -eq 0) { return $null }
        $pick = $sessions | Where-Object { $_.SourceAppUserModelId -match $AppMatch } | Select-Object -First 1
        # ⚠ 不再「退而求其次挑正在播放的那个」：B 站客户端、Edge 里的视频也会占用媒体会话，
        #    那样每切一个视频都会被当成换歌。只认 $AppMatch 里点名的播放器。
        if (-not $pick) { return $null }
        $props = Await ($pick.TryGetMediaPropertiesAsync()) $propsType
        $info = $pick.GetPlaybackInfo()
        $tl = $pick.GetTimelineProperties()
        return [pscustomobject][ordered]@{
            title    = [string]$props.Title
            artist   = [string]$props.Artist
            album    = [string]$props.AlbumTitle
            status   = [string]$info.PlaybackStatus
            position = [math]::Round($tl.Position.TotalSeconds, 1)
            duration = [math]::Round($tl.EndTime.TotalSeconds, 1)
            app      = [string]$pick.SourceAppUserModelId
        }
    } catch {
        return $null
    }
}

do {
    $np = Read-Current
    if ($null -eq $np) { '{}' }
    else { $np | ConvertTo-Json -Compress }
    if ($Once) { break }
    Start-Sleep -Seconds ([Math]::Max(1, $Interval))
} while ($true)
