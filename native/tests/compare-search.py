import json,subprocess,sys,math,pathlib
root=pathlib.Path(sys.argv[1]);executable=sys.argv[2]
cases=json.loads((root/'expected.json').read_text());failures=[]
for case in cases:
    command=[executable,str(root/'data'),case['query'],str(case['anchor']['lat']),str(case['anchor']['lon'])]
    if case['kind']=='address':command.append('address')
    result=subprocess.run(command,check=True,text=True,capture_output=True)
    actual=json.loads(result.stdout);expected=case['expected']
    if [p['id'] for p in actual]!=[p['id'] for p in expected]:
        failures.append((case['kind'],case['query'],case['anchor'],[p['id'] for p in expected],[p['id'] for p in actual]));continue
    for a,e in zip(actual,expected):
        if a['name']!=e['name'] or not math.isclose(a['matchScore'],e['score'],abs_tol=1e-5) or not math.isclose(a['distanceMeters'],e['distance'],abs_tol=.2):failures.append((case['kind'],case['query'],'values',e,a))
for failure in failures:print(failure)
print(f'{len(cases)-len(failures)}/{len(cases)} original search comparisons passed')
sys.exit(bool(failures))
