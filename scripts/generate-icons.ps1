$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$iconDir = Join-Path $root 'src-tauri/icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
foreach ($size in 32,128,256) {
  $bitmap = New-Object System.Drawing.Bitmap($size,$size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(255,28,39,28))
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,198,233,151))
  [System.Drawing.PointF[]]$points = @(
    [System.Drawing.PointF]::new($size*.59,$size*.12),
    [System.Drawing.PointF]::new($size*.27,$size*.56),
    [System.Drawing.PointF]::new($size*.47,$size*.56),
    [System.Drawing.PointF]::new($size*.39,$size*.89),
    [System.Drawing.PointF]::new($size*.75,$size*.40),
    [System.Drawing.PointF]::new($size*.54,$size*.40)
  )
  $graphics.FillPolygon($brush,$points)
  $name = if ($size -eq 256) {'icon.png'} else {"${size}x${size}.png"}
  $bitmap.Save((Join-Path $iconDir $name),[System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $brush.Dispose(); $bitmap.Dispose()
}
$png = [System.IO.File]::ReadAllBytes((Join-Path $iconDir 'icon.png'))
$stream = [System.IO.File]::Create((Join-Path $iconDir 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose()
