import urllib.request, json

# Login
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

# Get pending IDs
req = urllib.request.Request("http://localhost:8000/api/v1/cases/library/pending/", headers={"Authorization": f"Bearer {token}"})
pd = json.loads(urllib.request.urlopen(req).read())
ids = []
for e in pd["entries"]: ids.extend(e["case_sample_ids"])
print(f"Pending IDs: {len(ids)}")

if ids:
    # Create batch
    payload = json.dumps({"case_sample_ids": ids[:5]}).encode()
    req = urllib.request.Request("http://localhost:8000/api/v1/cases/library/", data=payload, headers={"Content-Type":"application/json","Authorization": f"Bearer {token}"}, method="POST")
    resp = json.loads(urllib.request.urlopen(req).read())
    print(f"Created: {resp.get('batch_number')}")

    # List
    req = urllib.request.Request("http://localhost:8000/api/v1/cases/library/", headers={"Authorization": f"Bearer {token}"})
    ld = json.loads(urllib.request.urlopen(req).read())
    print(f"List count: {ld.get('count')}")
    for r in ld["results"]: print(f"  {r['batch_number']} {r['status_display']} F:{r['female_count']} M:{r['male_blood_count']}")
