import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/pending_mixes/", headers={"Authorization": f"Bearer {token}"})
mixes = json.loads(urllib.request.urlopen(req).read()).get("mixes",[])
ids = [m["id"] for m in mixes[:2]] if mixes else ["test1"]
data = json.dumps({"mix_ids": ids, "chip_number": "CHIP001"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", data=data, headers={"Content-Type":"application/json", "Authorization":f"Bearer {token}"}, method="POST")
try:
    r = json.loads(urllib.request.urlopen(req).read())
    print("CREATE OK:", r.get("batch_number"))
except urllib.error.HTTPError as e:
    print("FAIL", e.code, e.read().decode()[:200])
