#!/bin/bash
BUILD_ID="2d78582c-da7f-4e7d-bb5b-b7cd3bf48a23"
while true; do
  RAW=$(npx eas build:view "$BUILD_ID" --json 2>/dev/null)
  STATUS=$(echo "$RAW" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      const start = d.indexOf('{');
      if (start === -1) { console.log('NO_JSON'); return; }
      try { console.log(JSON.parse(d.slice(start)).status); }
      catch(e) { console.log('PARSE_ERROR'); }
    });
  ")
  echo "$(date): status=$STATUS"
  if [ "$STATUS" = "FINISHED" ]; then
    echo "Build finished! Starting submit..."
    npx eas submit -p ios --profile production --id "$BUILD_ID" --non-interactive 2>&1
    exit 0
  fi
  if [ "$STATUS" = "ERRORED" ] || [ "$STATUS" = "CANCELED" ]; then
    echo "Build did not succeed: $STATUS"
    exit 1
  fi
  sleep 60
done
