import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]
req = urllib.request.Request("http://localhost:8000/api/v1/cases/dashboard/", headers={"Authorization": f"Bearer {token}"})
d = json.loads(urllib.request.urlopen(req).read())
print("OK. Stages:", list((d.get("workflow_stages") or {}).keys())[:5])
