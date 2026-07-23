import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/pending_mixes/", headers={"Authorization": f"Bearer {token}"})
resp = json.loads(urllib.request.urlopen(req).read())
print(f"Pending: {len(resp.get('mixes',[]))}")
for m in resp.get('mixes',[]):
    print(f"  {m['mix_name']}")
