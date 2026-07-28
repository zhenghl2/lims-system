import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

# Test dashboard
req = urllib.request.Request("http://localhost:8000/api/v1/cases/dashboard/", headers={"Authorization": f"Bearer {token}"})
d = json.loads(urllib.request.urlopen(req).read())
print("Dashboard keys:", list(d.keys())[:10])
print("Workflow stages:", d.get("workflow_stages", "NOT FOUND"))
print("Total samples:", d.get("total_samples", "N/A"))

# Check a CaseSample's stage
req = urllib.request.Request("http://localhost:8000/api/v1/cases/", headers={"Authorization": f"Bearer {token}"})
cases = json.loads(urllib.request.urlopen(req).read())
if cases.get("results"):
    cid = cases["results"][0]["id"]
    req2 = urllib.request.Request(f"http://localhost:8000/api/v1/cases/{cid}/", headers={"Authorization": f"Bearer {token}"})
    case = json.loads(urllib.request.urlopen(req2).read())
    samples = case.get("case_samples", [])
    if samples:
        s0 = samples[0]
        print(f"Sample {s0.get('test_sample_id')}: stage={s0.get('workflow_stage')}")
