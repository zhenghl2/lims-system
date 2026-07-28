import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]
req = urllib.request.Request("http://localhost:8000/api/v1/cases/", headers={"Authorization": f"Bearer {token}"})
cases = json.loads(urllib.request.urlopen(req).read())
for c in cases.get("results",[])[:1]:
    req2 = urllib.request.Request(f"http://localhost:8000/api/v1/cases/{c['id']}/", headers={"Authorization": f"Bearer {token}"})
    d = json.loads(urllib.request.urlopen(req2).read())
    for cs in d.get("case_samples",[])[:2]:
        print(f"  {cs.get('test_sample_id')}: stage={cs.get('workflow_stage')} active={cs.get('is_active')}")
