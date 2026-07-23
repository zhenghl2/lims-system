import urllib.request, json

# Login
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

# Get pending mixes
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/pending_mixes/", headers={"Authorization": f"Bearer {token}"})
mixes = json.loads(urllib.request.urlopen(req).read()).get("mixes",[])
print(f"Mixes: {len(mixes)}")
for m in mixes:
    print(f"  {m['mix_name']} F:{m['female']} M:{m['male']}")

# Create batch with only mix1
if mixes:
    mid = mixes[0]["id"]
    data = json.dumps({"mix_ids": [mid], "chip_number": "TEST001"}).encode()
    req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", data=data, headers={"Content-Type":"application/json", "Authorization":f"Bearer {token}"}, method="POST")
    r = json.loads(urllib.request.urlopen(req).read())
    print(f"\nCreated: {r['batch_number']}")
    
    # Check sample count
    req = urllib.request.Request(f"http://localhost:8000/api/v1/cases/hybseq/{r['id']}/", headers={"Authorization": f"Bearer {token}"})
    detail = json.loads(urllib.request.urlopen(req).read())
    print(f"Samples: total={detail['sample_count']} F={detail['female_count']} MB={detail['male_blood_count']} MO={detail['male_other_count']}")
    print(f"Expected: F={mixes[0]['female']} M={mixes[0]['male']}")
