param(
  [string]$BaseUrl = 'https://egoric-film-studio.leozvu-work.workers.dev',
  [string]$DatabaseName = 'egoric-film-studio',
  [switch]$SkipChat,
  [switch]$SkipImage,
  [switch]$SkipVoice,
  [switch]$SkipVideo
)

$ErrorActionPreference = 'Stop'
$apiKey = [string]$env:EGORIC_SHOPAIKEY_TEST_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw 'Set EGORIC_SHOPAIKEY_TEST_KEY before running this paid production smoke test.'
}

$base = $BaseUrl.TrimEnd('/')
$sessionBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($sessionBytes)
$sessionToken = [Convert]::ToBase64String($sessionBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$hashBytes = [System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($sessionToken))
$sessionHash = [Convert]::ToHexString($hashBytes).ToLowerInvariant()
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$expires = $now + 3600000
$results = [System.Collections.Generic.List[object]]::new()

function Invoke-D1([string]$Sql) {
  $output = & npx --yes wrangler@latest d1 execute $DatabaseName --remote --command $Sql --json 2>&1
  if ($LASTEXITCODE -ne 0) { throw "D1 command failed: $($output -join ' ')" }
}

function Get-ResponseShape([object]$Payload) {
  if ($null -eq $Payload) { return 'empty' }
  if ($Payload -is [string]) { return 'text' }
  return (($Payload.PSObject.Properties.Name | Sort-Object) -join ',')
}

function Invoke-ProviderRequest {
  param(
    [string]$Name,
    [string]$Method,
    [string]$Path,
    [object]$Body,
    [int[]]$Expected = @(200)
  )
  $params = @{
    Uri = "$base$Path"
    Method = $Method
    Headers = @{
      Accept = 'application/json'
      Authorization = "Bearer $apiKey"
      Cookie = "__Host-egoric_session=$sessionToken"
      Origin = $base
    }
    SkipHttpErrorCheck = $true
    UseBasicParsing = $true
    TimeoutSec = 900
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = $Body | ConvertTo-Json -Depth 30 -Compress
  }

  $watch = [Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-WebRequest @params
  $watch.Stop()
  $payload = $null
  if ($response.Content) {
    try { $payload = $response.Content | ConvertFrom-Json } catch { $payload = [string]$response.Content }
  }
  $passed = $Expected -contains [int]$response.StatusCode
  $results.Add([pscustomobject]@{
    name = $Name
    status = [int]$response.StatusCode
    durationMs = $watch.ElapsedMilliseconds
    responseShape = Get-ResponseShape $payload
    passed = $passed
  })
  if (-not $passed) {
    $message = [string]($payload.error.message ?? $payload.message ?? $payload.detail ?? "HTTP $($response.StatusCode)")
    if ($message.Length -gt 240) { $message = $message.Substring(0, 240) }
    throw "$Name failed: $message"
  }
  return $payload
}

try {
  Invoke-D1 "INSERT INTO egoric_auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at) SELECT '$sessionHash', id, $now, $expires, $now, NULL FROM egoric_auth_users WHERE role = 'owner' AND status = 'active' ORDER BY created_at ASC LIMIT 1;"

  $models = Invoke-ProviderRequest 'Model catalog' GET '/api-proxy/shopaikey/v1/models' $null
  if (-not $models.data -or $models.data.Count -lt 1) { throw 'Model catalog returned no models.' }

  if (-not $SkipChat) {
    $chat = Invoke-ProviderRequest 'Chat completion' POST '/api-proxy/shopaikey/v1/chat/completions' @{
      model = 'grok-4-1-fast-reasoning'
      messages = @(@{ role = 'user'; content = 'Reply with exactly: EGORIC_OK' })
      temperature = 0
      max_tokens = 32
    }
    if (-not $chat.choices[0].message.content) { throw 'Chat response has no message content.' }
  }

  if (-not $SkipImage) {
    $image = Invoke-ProviderRequest 'Image generation' POST '/api-proxy/shopaikey/images/google/generations' @{
      model = 'nano-banana-2'
      prompt = 'Premium minimalist product photograph of a matte black coffee cup on a clean studio table, no text, no logo.'
      size = '1:1'
      imageSize = '2K'
      format = 'png'
      response_format = 'b64_json'
    }
    if (-not $image.data[0].b64_json -and -not $image.data[0].url) { throw 'Image response has no image payload.' }
  }

  if (-not $SkipVoice) {
    $voice = Invoke-ProviderRequest 'Vietnamese TTS' POST '/api-proxy/shopaikey/tts/google/generations' @{
      text = 'Xin chào, đây là lượt kiểm thử giọng nói của Egoric.'
      model = 'gemini-2.5-flash-preview-tts'
      voice = 'Kore'
    }
    if (-not $voice.url -and -not $voice.data.url) { throw 'TTS response has no audio URL.' }
  }

  if (-not $SkipVideo) {
    $created = Invoke-ProviderRequest 'Video generation submit' POST '/api-proxy/shopaikey/v1/video/generations' @{
      model = 'veo3.1-fast'
      prompt = 'A cinematic five-second close-up of a matte black coffee cup on a studio table, subtle camera push-in, no text, no logo.'
      metadata = @{ aspect_ratio = '16:9'; enhance_prompt = $true; enable_upsample = $false }
    }
    $taskId = [string]($created.data.task_id ?? $created.data.taskId ?? $created.task_id ?? $created.taskId)
    if ([string]::IsNullOrWhiteSpace($taskId)) { throw 'Video submit response has no task ID.' }

    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(20)
    do {
      Start-Sleep -Seconds 8
      $statusPayload = Invoke-ProviderRequest 'Video generation poll' GET "/api-proxy/shopaikey/v1/video/generations/$([Uri]::EscapeDataString($taskId))" $null
      $status = [string]($statusPayload.data.status ?? $statusPayload.status)
      if ($status -in @('SUCCESS', 'success', 'completed', 'succeeded')) {
        $videoUrl = [string]($statusPayload.data.result_url ?? $statusPayload.data.resultUrl ?? $statusPayload.result_url ?? $statusPayload.resultUrl)
        if ([string]::IsNullOrWhiteSpace($videoUrl)) { throw 'Completed video response has no result URL.' }
        break
      }
      if ($status -in @('FAILURE', 'failure', 'failed', 'error')) {
        $reason = [string]($statusPayload.data.fail_reason ?? $statusPayload.fail_reason ?? 'unknown provider failure')
        throw "Video task failed: $reason"
      }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if ([string]::IsNullOrWhiteSpace($videoUrl)) { throw 'Video task did not finish within 20 minutes.' }
  }
}
finally {
  Invoke-D1 "DELETE FROM egoric_auth_sessions WHERE token_hash = '$sessionHash';"
}

$failed = @($results | Where-Object { -not $_.passed })
[pscustomobject]@{
  baseUrl = $base
  paidSmoke = $true
  total = $results.Count
  passed = $results.Count - $failed.Count
  failed = $failed.Count
  results = $results
} | ConvertTo-Json -Depth 6

if ($failed.Count) { exit 1 }
