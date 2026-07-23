import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", headers={"Authorization": f"Bearer {token}"})
batches = json.loads(urllib.request.urlopen(req).read()).get("results",[])
if batches:
    req2 = urllib.request.Request(f"http://localhost:8000/api/v1/cases/hybseq/{batches[0]['id']}/", headers={"Authorization": f"Bearer {token}"})
    d = json.loads(urllib.request.urlopen(req2).read())
    samples = d.get("female_samples",[]) + d.get("male_blood_samples",[]) + d.get("male_other_samples",[])
    if samples:
        s = samples[0]
        print(f"Sample: PT={s.get('test_sample_id')} index={s.get('index')} type={s.get('experiment_sample_type')}")
        print(f"Has index field: {'index' in s}")
    else:
        print("No samples in batch")
else:
    print("No batches")
