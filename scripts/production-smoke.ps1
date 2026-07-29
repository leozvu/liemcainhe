param(
  [string]$BaseUrl = 'https://egoric-film-studio.leozvu-work.workers.dev',
  [string]$DatabaseName = 'egoric-film-studio'
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$projectId = "qa_project_$runId"
$usageId = "qa_usage_$runId"
$eventMessage = "QA_EVENT_$runId"
$campaignId = "qa_campaign_$runId"
$workspaceItemId = "qa_client_$runId"
$jobId = "qa_job_$runId"
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

function Invoke-QARequest {
  param(
    [string]$Name,
    [string]$Method,
    [string]$Path,
    [object]$Body,
    [int[]]$Expected = @(200),
    [switch]$Anonymous
  )
  $headers = @{ Accept = 'application/json'; Origin = $base }
  if (-not $Anonymous) { $headers.Cookie = "__Host-egoric_session=$sessionToken" }
  $params = @{
    Uri = "$base$Path"
    Method = $Method
    Headers = $headers
    SkipHttpErrorCheck = $true
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = $Body | ConvertTo-Json -Depth 30 -Compress
  }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-WebRequest @params
  $watch.Stop()
  $passed = $Expected -contains [int]$response.StatusCode
  $results.Add([pscustomobject]@{
    name = $Name
    method = $Method
    path = $Path
    status = [int]$response.StatusCode
    expected = ($Expected -join '|')
    durationMs = $watch.ElapsedMilliseconds
    passed = $passed
  })
  if (-not $passed) {
    $preview = [string]$response.Content
    if ($preview.Length -gt 300) { $preview = $preview.Substring(0, 300) }
    throw "$Name returned HTTP $($response.StatusCode): $preview"
  }
  if (-not $response.Content) { return $null }
  try { return $response.Content | ConvertFrom-Json } catch { return $response.Content }
}

try {
  Invoke-D1 "INSERT INTO egoric_auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at) SELECT '$sessionHash', id, $now, $expires, $now, NULL FROM egoric_auth_users WHERE role = 'owner' AND status = 'active' ORDER BY created_at ASC LIMIT 1;"

  Invoke-QARequest 'Public auth state' GET '/api/auth/state' $null @(200) -Anonymous | Out-Null
  Invoke-QARequest 'Protected route rejects anonymous' GET '/api/cloud/projects' $null @(401) -Anonymous | Out-Null
  Invoke-QARequest 'Current user' GET '/api/auth/me' $null @(200) | Out-Null
  Invoke-QARequest 'Team directory' GET '/api/auth/team' $null @(200) | Out-Null
  Invoke-QARequest 'Account dashboard' GET '/api/account' $null @(200) | Out-Null
  Invoke-QARequest 'Workspace health' GET '/api/cloud/workspace/health' $null @(200) | Out-Null
  Invoke-QARequest 'Workspace pull' GET '/api/cloud/workspace?collection=agencyClients&since=0' $null @(200) | Out-Null

  $project = @{
    id = $projectId
    title = "Production QA $runId"
    stage = 'script'
    rawScript = 'Một cảnh thử nghiệm QA.'
    targetDuration = '15s'
    language = 'Vietnamese'
    visualStyle = 'live-action'
    shots = @()
    createdAt = $now
    lastModified = $now
  }
  Invoke-QARequest 'Create cloud project' PUT "/api/cloud/projects/$projectId" $project @(200) | Out-Null
  Invoke-QARequest 'Read cloud project' GET "/api/cloud/projects/$projectId" $null @(200) | Out-Null
  Invoke-QARequest 'List cloud projects' GET '/api/cloud/projects' $null @(200) | Out-Null

  $workspacePayload = @{
    collection = 'agencyClients'
    records = @(@{ id = $workspaceItemId; payload = @{ id = $workspaceItemId; name = 'QA Client' }; updatedAt = $now })
  }
  Invoke-QARequest 'Workspace push' PUT '/api/cloud/workspace' $workspacePayload @(200) | Out-Null
  Invoke-QARequest 'Workspace readback' GET "/api/cloud/workspace?collection=agencyClients&since=$($now - 1)" $null @(200) | Out-Null

  $job = @{
    id = $jobId
    kind = 'creative-director'
    stage = 'director'
    label = 'Production QA job'
    status = 'queued'
    progress = 0
    completedUnits = 0
    totalUnits = 1
    resourceId = $projectId
    idempotencyKey = "qa:$runId"
    attempts = 0
    createdAt = $now
    updatedAt = $now
  }
  Invoke-QARequest 'Claim durable job' POST "/api/jobs?projectId=$projectId" @{ job = $job } @(201) | Out-Null
  Invoke-QARequest 'Reject duplicate durable job' POST "/api/jobs?projectId=$projectId" @{ job = $job } @(409) | Out-Null
  Invoke-QARequest 'Read durable jobs' GET "/api/jobs?projectId=$projectId" $null @(200) | Out-Null

  Invoke-QARequest 'Create review note' POST "/api/reviews?projectId=$projectId" @{ stage = 'script'; body = 'QA review note' } @(201) | Out-Null
  Invoke-QARequest 'Approve review stage' PUT "/api/reviews?projectId=$projectId" @{ stage = 'script'; status = 'approved'; note = 'QA approved' } @(200) | Out-Null
  Invoke-QARequest 'Read review ledger' GET "/api/reviews?projectId=$projectId" $null @(200) | Out-Null

  Invoke-QARequest 'Write usage telemetry' POST '/api/account/usage' @{
    id = $usageId; projectId = $projectId; kind = 'chat'; providerId = 'qa'; modelId = 'qa'; units = 1; estimatedCostUsd = 0; status = 'success'; timestamp = $now
  } @(201) | Out-Null
  Invoke-QARequest 'Write system event' POST '/api/account/events' @{ projectId = $projectId; severity = 'info'; source = 'production-qa'; message = $eventMessage } @(201) | Out-Null

  Invoke-QARequest 'Write campaign economics' PUT '/api/agency-economics' @{
    campaignId = $campaignId; campaignName = 'QA Campaign'; clientName = 'QA Client'; quotedRevenueVnd = 1000000; laborHours = 1; laborHourlyRateVnd = 100000; exchangeRateVndPerUsd = 26000
  } @(200) | Out-Null
  Invoke-QARequest 'Read campaign economics' GET '/api/agency-economics' $null @(200) | Out-Null
  Invoke-QARequest 'Distribution operations readiness' GET "/api/distribution-operations?projectId=$projectId" $null @(200) | Out-Null
  Invoke-QARequest 'Trend proxy' GET '/api-proxy/trends/vnexpress-congnghe' $null @(200, 502) | Out-Null
  Invoke-QARequest 'Media binding readiness' POST '/api/cloud/media/import' @{ projectId = $projectId; path = 'qa/test.png'; sourceUrl = 'https://example.com/test.png' } @(503) | Out-Null

  Invoke-QARequest 'Delete cloud project' DELETE "/api/cloud/projects/$projectId" $null @(200) | Out-Null
}
finally {
  Invoke-D1 "DELETE FROM egoric_auth_sessions WHERE token_hash = '$sessionHash'; DELETE FROM egoric_workspace_items WHERE item_id = '$workspaceItemId'; DELETE FROM egoric_usage_events WHERE id = '$usageId'; DELETE FROM egoric_system_events WHERE message = '$eventMessage'; DELETE FROM egoric_campaign_financials WHERE campaign_id = '$campaignId'; DELETE FROM egoric_projects WHERE project_id = '$projectId'; DELETE FROM egoric_jobs WHERE project_id = '$projectId'; DELETE FROM egoric_review_notes WHERE project_id = '$projectId'; DELETE FROM egoric_stage_approvals WHERE project_id = '$projectId';"
}

$failed = @($results | Where-Object { -not $_.passed })
[pscustomobject]@{
  baseUrl = $base
  total = $results.Count
  passed = $results.Count - $failed.Count
  failed = $failed.Count
  results = $results
} | ConvertTo-Json -Depth 6

if ($failed.Count) { exit 1 }
