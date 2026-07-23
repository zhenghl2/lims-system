import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/pending_mixes/", headers={"Authorization": f"Bearer {token}"})
mixes = json.loads(urllib.request.urlopen(req).read()).get("mixes",[])
if len(mixes)>=2:
    ids = [m["id"] for m in mixes[:2]]
    data = json.dumps({"mix_ids": ids, "chip_number": "T2"}).encode()
    req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", data=data, headers={"Content-Type":"application/json", "Authorization":f"Bearer {token}"}, method="POST")
    r = json.loads(urllib.request.urlopen(req).read())
    req = urllib.request.Request(f"http://localhost:8000/api/v1/cases/hybseq/{r['id']}/", headers={"Authorization": f"Bearer {token}"})
    d = json.loads(urllib.request.urlopen(req).read())
    total_f = sum(m['female'] for m in mixes[:2])
    total_m = sum(m['male'] for m in mixes[:2])
    ok = d['female_count']==total_f and d['male_blood_count']+d['male_other_count']==total_m
    print(f"Both: F={d['female_count']}/{total_f} M={d['male_blood_count']+d['male_other_count']}/{total_m} {'OK' if ok else 'FAIL'}")
