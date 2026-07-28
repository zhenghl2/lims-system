import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

# Get latest PP batch
req2 = urllib.request.Request("http://localhost:8000/api/v1/cases/preprocessing/?ordering=-created_at", headers={"Authorization": f"Bearer {token}"})
pp_batches = json.loads(urllib.request.urlopen(req2).read()).get("results",[])
if pp_batches:
    b = pp_batches[0]
    print(f"Latest PP: {b['batch_number']} status={b['status']}")
    # Get detail
    req3 = urllib.request.Request(f"http://localhost:8000/api/v1/cases/preprocessing/{b['id']}/", headers={"Authorization": f"Bearer {token}"})
    detail = json.loads(urllib.request.urlopen(req3).read())
    for s in detail.get("female_samples",[]) + detail.get("male_blood_samples",[]) + detail.get("male_other_samples",[]):
        print(f"  {s.get('sample_id')}: qc={s.get('qc_status')} case_ids={s.get('case_sample_ids')}")

# Check the case_samples status
req4 = urllib.request.Request("http://localhost:8000/api/v1/cases/dashboard/", headers={"Authorization": f"Bearer {token}"})
dash = json.loads(urllib.request.urlopen(req4).read())
print(f"\nDashboard stages: {json.dumps(dash.get('workflow_stages',{}))}")
