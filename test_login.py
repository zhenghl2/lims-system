import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
try:
    token = json.loads(urllib.request.urlopen(req).read())["access"]
    print("LOGIN OK")
except Exception as e:
    print("FAIL:", str(e)[:100])
