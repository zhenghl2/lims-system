import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", headers={"Authorization": f"Bearer {token}"})
batches = json.loads(urllib.request.urlopen(req).read()).get("results",[])
for b in batches:
    req2 = urllib.request.Request(f"http://localhost:8000/api/v1/cases/hybseq/{b['id']}/", headers={"Authorization": f"Bearer {token}"}, method="DELETE")
    try:
        resp = urllib.request.urlopen(req2)
        print(f"Deleted {b['batch_number']}: {resp.read().decode()[:100]}")
    except urllib.error.HTTPError as e:
        print(f"FAIL {b['batch_number']}: {e.code} {e.read().decode()[:200]}")
