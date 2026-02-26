$ErrorActionPreference='Stop'
$u='http://localhost:8080/api/embeddings/extract'
$payload='c:\Users\practicante\Desktop\bmpi-main\tmp-test-photos\request201-4photos.json'
$body=Get-Content -Raw -Path $payload

$result=[ordered]@{}
foreach($m in @('legacy','batch','auto')){
  $times=@()
  $runs=@()
  for($i=1;$i -le 3;$i++){
    $sw=[Diagnostics.Stopwatch]::StartNew()
    $r=Invoke-RestMethod -Method Post -Uri ($u+'?mode='+$m) -ContentType 'application/json' -Body $body
    $sw.Stop()
    $ms=[math]::Round($sw.Elapsed.TotalMilliseconds,2)
    $times+=$ms
    $runs += [ordered]@{
      run=$i
      ms=$ms
      mode=$r.mode
      results=$r.results.Count
      errors=$r.errors.Count
    }
  }
  $avg=[math]::Round((($times|Measure-Object -Average).Average),2)
  $min=[math]::Round((($times|Measure-Object -Minimum).Minimum),2)
  $max=[math]::Round((($times|Measure-Object -Maximum).Maximum),2)

  $result[$m]=[ordered]@{
    runs=$runs
    avg_ms=$avg
    min_ms=$min
    max_ms=$max
  }
}

$legacy=$result['legacy'].avg_ms
$batch=$result['batch'].avg_ms
$auto=$result['auto'].avg_ms

$improveBatch=[math]::Round((($legacy-$batch)/$legacy)*100,2)
$improveAuto=[math]::Round((($legacy-$auto)/$legacy)*100,2)

$out=[ordered]@{
  timestamp=(Get-Date).ToString('o')
  payload='request201-4photos.json'
  benchmark=$result
  improvements=[ordered]@{
    legacy_to_batch_percent=$improveBatch
    legacy_to_auto_percent=$improveAuto
  }
}

$outPath='c:\Users\practicante\Desktop\bmpi-main\tmp-test-photos\benchmark_modes_result.json'
($out | ConvertTo-Json -Depth 8) | Set-Content -Path $outPath -Encoding UTF8
Write-Output $outPath
