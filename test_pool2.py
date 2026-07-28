import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

# Check Library batches
req2 = urllib.request.Request("http://localhost:8000/api/v1/cases/library/", headers={"Authorization": f"Bearer {token}"})
d = json.loads(urllib.request.urlopen(req2).read())
print("Library batches:", len(d.get("results",[])))
for b in d.get("results",[]):
    print(f"  {b['batch_number']} status={b.get('status')} samples={b.get('sample_count','?')}")

# Check Pooling batches
req3 = urllib.request.Request("http://localhost:8000/api/v1/cases/pooling/", headers={"Authorization": f"Bearer {token}"})
d3 = json.loads(urllib.request.urlopen(req3).read())
print("Pooling batches:", len(d3.get("results",[])))
for b in d3.get("results",[]):
    print(f"  {b['batch_number']} status={b.get('status')}")

# Try creating a pooling batch
req4 = urllib.request.Request("http://localhost:8000/api/v1/cases/pooling/", data=json.dumps({}).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type":"application/json"}, method="POST")
try:
    resp4 = urllib.request.urlopen(req4)
    print("Create:", resp4.status, resp4.read().decode()[:300])
except urllib.error.HTTPError as e:
    print("Create error:", e.status, e.read().decode()[:500])
