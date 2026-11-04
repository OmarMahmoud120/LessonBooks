#!/bin/sh
set -eu
if [ -f /data/export/firebase-export-metadata.json ]; then
  set -- --import=/data/export
else
  set --
fi
exec /app/node_modules/.bin/firebase --config /app/firebase.json emulators:start --project demo-lessonbooks --only auth,firestore,storage --export-on-exit=/data/export "$@"
