import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/pending_mixes/", headers={"Authorization": f"Bearer {token}"})
mixes = json.loads(urllib.request.urlopen(req).read()).get("mixes",[])
print(f"Mixes: {len(mixes)}")

for m in mixes:
    print(f"  {m['mix_name']} F:{m['female']} M:{m['male']}")

if mixes:
    # Create with only mix1
    mid = mixes[0]["id"]
    data = json.dumps({"mix_ids": [mid], "chip_number": "T1"}).encode()
    req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", data=data, headers={"Content-Type":"application/json", "Authorization":f"Bearer {token}"}, method="POST")
    r = json.loads(urllib.request.urlopen(req).read())
    print(f"Created: {r['batch_number']}")
    
    req = urllib.request.Request(f"http://localhost:8000/api/v1/cases/hybseq/{r['id']}/", headers={"Authorization": f"Bearer {token}"})
    d = json.loads(urllib.request.urlopen(req).read())
    exp_f = mixes[0]['female']
    exp_m = mixes[0]['male']
    actual_f = d['female_count']
    actual_m = d['male_blood_count']+d['male_other_count']
    ok = actual_f==exp_f and actual_m==exp_m
    print(f"Samples: F={actual_f}/{exp_f} M={actual_m}/{exp_m} {'OK' if ok else 'FAIL'}")
