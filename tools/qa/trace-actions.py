"""Read bounded action/error metadata from a saved Playwright trace; never browser state."""
import json
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as trace:
    actions = {}
    for name in trace.namelist():
        if not name.endswith('.trace'):
            continue
        for line in trace.read(name).decode('utf-8').splitlines():
            row = json.loads(line)
            if row.get('type') == 'before':
                if row.get('method') not in ['click', 'press', 'fill', 'expect', 'screenshot', 'goto']:
                    continue
                actions[row.get('callId')] = {
                    'method': row.get('method'),
                    'title': row.get('title'),
                    'params': row.get('params'),
                    'start': row.get('startTime'),
                }
            if row.get('type') == 'after' and row.get('callId') in actions:
                actions[row['callId']].update(end=row.get('endTime'), error=row.get('error'))
    for row in list(actions.values())[-18:]:
        print(json.dumps(row, ensure_ascii=False))
