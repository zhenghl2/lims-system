import urllib.request, json

# Login
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

# Test pending_mixes
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/pending_mixes/", headers={"Authorization": f"Bearer {token}"})
resp = json.loads(urllib.request.urlopen(req).read())
print("Pending mixes:", len(resp.get("mixes",[])))

# Test create with actual mix IDs if any
mixes = resp.get("mixes",[])
if mixes:
    ids = [m["id"] for m in mixes[:2]]
    data = json.dumps({"mix_ids": ids, "chip_number": "CHIP001"}).encode()
    req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", data=data, headers={"Content-Type":"application/json", "Authorization":f"Bearer {token}"}, method="POST")
    try:
        resp2 = json.loads(urllib.request.urlopen(req).read())
        print("Create OK:", resp2.get("batch_number"))
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"Create FAIL {e.code}:", body[:500])
else:
    print("No mixes available - no COMPLETED pooling batches")
