import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())["access"]
req2 = urllib.request.Request("http://localhost:8000/api/v1/cases/extraction/", headers={"Authorization": f"Bearer {token}"})
resp2 = urllib.request.urlopen(req2)
data2 = json.loads(resp2.read())
print("Count:", data2.get("count"))
for r in data2.get("results", []):
    print(r.get("batch_number"), r.get("status"))
