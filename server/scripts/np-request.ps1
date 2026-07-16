# Nova Post HTTP bridge — UTF-8 JSON on stdout
param(
    [Parameter(Mandatory = $true)]
    [string]$PayloadPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$p = Get-Content -Raw -Path $PayloadPath -Encoding UTF8 | ConvertFrom-Json

try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
} catch {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

$headers = @{
    Accept            = 'application/json'
    'User-Agent'      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    'Accept-Language' = 'en'
    Origin            = 'https://my.novapost.com'
    Referer           = 'https://my.novapost.com/'
}
if ($p.headers) {
    foreach ($prop in $p.headers.PSObject.Properties) {
        $headers[$prop.Name] = [string]$prop.Value
    }
}

$url = [string]$p.url
$method = [string]$p.method
if (-not $method) { $method = 'GET' }

function Write-Envelope($ok, $data, $status, $error) {
    if ($ok) {
        @{ ok = $true; data = $data } | ConvertTo-Json -Depth 30 -Compress
    } else {
        @{ ok = $false; status = $status; error = $error } | ConvertTo-Json -Compress
    }
}

function Invoke-NpViaRestMethod {
    param($Url, $Method, $Headers, $Body)
    $params = @{
        Uri     = $Url
        Method  = $Method
        Headers = $Headers
    }
    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 30 -Compress)
        $params.ContentType = 'application/json; charset=utf-8'
    }
    return Invoke-RestMethod @params
}

function Invoke-NpViaHttpClient {
    param($Url, $Method, $Headers, $Body)
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(90)
    try {
        $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::new($Method), $Url)
        foreach ($kv in $Headers.GetEnumerator()) {
            if ($kv.Key -ieq 'Content-Type') { continue }
            [void]$request.Headers.TryAddWithoutValidation($kv.Key, $kv.Value)
        }
        if ($Body) {
            $bodyJson = ($Body | ConvertTo-Json -Depth 30 -Compress)
            $mediaType = 'application/json'
            if ($Headers.ContainsKey('Content-Type')) {
                $mediaType = ($Headers['Content-Type'] -split ';')[0].Trim()
            }
            $request.Content = New-Object System.Net.Http.StringContent($bodyJson, [System.Text.Encoding]::UTF8, $mediaType)
        }
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        return @{
            Ok     = $response.IsSuccessStatusCode
            Status = [int]$response.StatusCode
            Text   = $text
        }
    } finally {
        $client.Dispose()
    }
}

try {
    $useHttpClient = $false
    try {
        Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
        $useHttpClient = $true
    } catch {
        $useHttpClient = $false
    }

    if ($useHttpClient) {
        $raw = Invoke-NpViaHttpClient -Url $url -Method $method -Headers $headers -Body $p.body
        if ($raw.Ok) {
            if ($raw.Text) {
                $parsed = $raw.Text | ConvertFrom-Json
                Write-Envelope $true $parsed $null $null
            } else {
                Write-Envelope $true @{} $null $null
            }
            exit 0
        }

        $fallbackError = $raw.Text
        if (-not $fallbackError) { $fallbackError = "HTTP $($raw.Status)" }
        try {
            $result = Invoke-NpViaRestMethod -Url $url -Method $method -Headers $headers -Body $p.body
            Write-Envelope $true $result $null $null
            exit 0
        } catch {
            Write-Envelope $false $null $raw.Status $fallbackError
            exit 0
        }
    }

    $result = Invoke-NpViaRestMethod -Url $url -Method $method -Headers $headers -Body $p.body
    Write-Envelope $true $result $null $null
} catch {
    $status = 0
    $errBody = $_.Exception.Message
    if ($_.Exception.Response) {
        $status = [int]$_.Exception.Response.StatusCode
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $errBody = $reader.ReadToEnd()
        } catch { }
    }
    Write-Envelope $false $null $status $errBody
}
