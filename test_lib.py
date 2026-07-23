import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())["access"]
req2 = urllib.request.Request("http://localhost:8000/api/v1/cases/library/pending/", headers={"Authorization": f"Bearer {token}"})
resp2 = urllib.request.urlopen(req2)
data2 = json.loads(resp2.read())
print("Pending:", data2.get("total_pending"), "female:", data2.get("female_count"))
