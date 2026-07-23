import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", headers={"Authorization": f"Bearer {token}"})
resp = json.loads(urllib.request.urlopen(req).read())
for b in resp.get("results",[]):
    print(f"Batch: {b.get('batch_number')} status={b.get('status_display')}")
    req2 = urllib.request.Request(f"http://localhost:8000/api/v1/cases/hybseq/{b['id']}/", headers={"Authorization": f"Bearer {token}"})
    d = json.loads(urllib.request.urlopen(req2).read())
    print(f"  Detail OK, has hyb_seq_data: {'hyb_seq_data' in d}, samples: {d.get('sample_count')}")
