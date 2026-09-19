$ErrorActionPreference = "Stop"
$models = Split-Path -Parent $MyInvocation.MyCommand.Path

$downloads = @(
    @{
        Name = "face_detection_yunet_2023mar.onnx"
        Url = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
    },
    @{
        Name = "face_recognition_sface_2021dec.onnx"
        Url = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
    }
)

foreach ($item in $downloads) {
    $destination = Join-Path $models $item.Name
    Write-Host "Downloading $($item.Name)..."
    Invoke-WebRequest -Uri $item.Url -OutFile $destination
}

Write-Host "Face models downloaded to $models"
