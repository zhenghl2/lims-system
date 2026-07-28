import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

req2 = urllib.request.Request("http://localhost:8000/api/v1/cases/pooling/pending/", headers={"Authorization": f"Bearer {token}"})
resp = urllib.request.urlopen(req2)
print("Status:", resp.status)
print(resp.read().decode()[:500])
