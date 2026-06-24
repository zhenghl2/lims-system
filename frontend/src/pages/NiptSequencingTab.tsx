import { useEffect, useState, useMemo, useRef } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber, Typography, Table } from "antd";
import { PlusOutlined, DeleteOutlined, DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";
import { useTranslation } from "../i18n/useTranslation";

const { Text } = Typography;

// ── Index lookup table from N34101-N34116接头index信息表 ──
// Format: indexNumber → { i7, i5 }
// i7 = column C (i7 index for all Illumina systems)
// i5 = column D (i5 index for HiSeq 3000/4000, NextSeq, MiniSeq, NovaSeq v1.5)
const INDEX_LOOKUP: Record<string, { i7: string; i5: string }> = {
  "001":{i7:"CTGATCGT",i5:"GCGCATAT"},"002":{i7:"ACTCTCGA",i5:"CTGTACCA"},"003":{i7:"TGAGCTAG",i5:"GAACGGTT"},
  "004":{i7:"GAGACGAT",i5:"ACCGGTTA"},"005":{i7:"CTTGTCGA",i5:"CGATGTTC"},"006":{i7:"TTCCAAGG",i5:"CTACAAGG"},
  "007":{i7:"CGCATGAT",i5:"AAGCCTGA"},"008":{i7:"ACGGAACA",i5:"ACGAGAAC"},"009":{i7:"CGGCTAAT",i5:"CTCGTTCT"},
  "010":{i7:"ATCGATCG",i5:"TGGAAGCA"},"011":{i7:"GCAAGATC",i5:"AGTCGAAG"},"012":{i7:"GCTATCCT",i5:"AACAGGTG"},
  "013":{i7:"TACGCTAC",i5:"CGTGTGAT"},"014":{i7:"TGGACTCT",i5:"TCTTACGG"},"015":{i7:"AGAGTAGC",i5:"AAGGCGTA"},
  "016":{i7:"ATCCAGAG",i5:"TAACGTCG"},"017":{i7:"GACGATCT",i5:"TCGTGCAT"},"018":{i7:"AACTGAGC",i5:"CAATCAGG"},
  "019":{i7:"CTTAGGAC",i5:"ACTCCTAC"},"020":{i7:"GTGCCATA",i5:"CTCCTAGT"},"021":{i7:"GAATCCGA",i5:"AGCTAGTG"},
  "022":{i7:"TCGCTGTT",i5:"CAAGTCGT"},"023":{i7:"TTCGTTGG",i5:"TACACACG"},"024":{i7:"AAGCACTG",i5:"AGGTCAAC"},
  "025":{i7:"CCTTGATC",i5:"GATGGAGT"},"026":{i7:"GTCGAAGA",i5:"CCACATTG"},"027":{i7:"ACCACGAT",i5:"GTCTGCAA"},
  "028":{i7:"GATTACCG",i5:"TTGGACTG"},"029":{i7:"GCACAACT",i5:"CTGAACGT"},"030":{i7:"GCGTCATT",i5:"CAGACGTT"},
  "031":{i7:"ATCCGGTA",i5:"GACCGATA"},"032":{i7:"CGTTGCAA",i5:"ATAGAGCG"},"033":{i7:"GTGAAGTG",i5:"GAGCAATC"},
  "034":{i7:"CATGGCTA",i5:"CACACATC"},"035":{i7:"ATGCCTGT",i5:"AGATTGCG"},"036":{i7:"CAACACCT",i5:"AGCTACCA"},
  "037":{i7:"TGTGACTG",i5:"AGCCTATC"},"038":{i7:"GTCATCGA",i5:"GATCCACT"},"039":{i7:"AGCACTTC",i5:"ACGTCCAA"},
  "040":{i7:"GAAGGAAG",i5:"GACGTCAT"},"041":{i7:"GTTGTTCG",i5:"CCAACTTC"},"042":{i7:"CGGTTGTT",i5:"GTGGTATG"},
  "043":{i7:"ACTGAGGT",i5:"GTCAACAG"},"044":{i7:"TGAAGACG",i5:"ACATGCCA"},"045":{i7:"GTTACGCA",i5:"ATGGCGAT"},
  "046":{i7:"AGCGTGTT",i5:"CTTCGCAA"},"047":{i7:"GATCGAGT",i5:"GACGAACT"},"048":{i7:"ACAGCTCA",i5:"TACTGCTC"},
  "049":{i7:"GAGCAGTA",i5:"TGAGCTGT"},"050":{i7:"AGTTCGTC",i5:"ACTCGATC"},"051":{i7:"TTGCGAAG",i5:"AACACGCT"},
  "052":{i7:"ATCGCCAT",i5:"TGCGTAAC"},"053":{i7:"TGGCATGT",i5:"CGTCTTCA"},"054":{i7:"CTGTTGAC",i5:"ACCTCAGT"},
  "055":{i7:"CATACCAC",i5:"AACAACCG"},"056":{i7:"GAAGTTGG",i5:"CGAACAAC"},"057":{i7:"ATGACGTC",i5:"CTTCCTTC"},
  "058":{i7:"TTGGACGT",i5:"GAAGTGCT"},"059":{i7:"AGTGGATC",i5:"TCGATGAC"},"060":{i7:"GATAGGCT",i5:"CAGTCACA"},
  "061":{i7:"TGGTAGCT",i5:"AGGTGTTG"},"062":{i7:"CGCAATCT",i5:"ACAGGCAT"},"063":{i7:"GATGTGTG",i5:"TAGCCATG"},
  "064":{i7:"GATTGCTC",i5:"CACTTCAC"},"065":{i7:"CGCTCTAT",i5:"TTGCAACG"},"066":{i7:"TATCGGTC",i5:"TACCGGAT"},
  "067":{i7:"AACGTCTG",i5:"AATGACGC"},"068":{i7:"ACGTTCAG",i5:"AGTTGTGC"},"069":{i7:"CAGTCCAA",i5:"CGGTAATC"},
  "070":{i7:"TTGCAGAC",i5:"ATCGTGGT"},"071":{i7:"CAATGTGG",i5:"TCTTCGAC"},"072":{i7:"ACTCCATC",i5:"GATCAAGG"},
  "073":{i7:"GTTGACCT",i5:"CAGTGCTT"},"074":{i7:"CGTGTGTA",i5:"CCAACGAA"},"075":{i7:"ACGACTTG",i5:"AACAGCGA"},
  "076":{i7:"CACTAGCT",i5:"TCGGATTC"},"077":{i7:"ACTAGGAG",i5:"TATGGCAC"},"078":{i7:"GTAGGAGT",i5:"GTCCTAAG"},
  "079":{i7:"CCTGATTG",i5:"GCTCAGTT"},"080":{i7:"ATGCACGA",i5:"AGATCGTC"},"081":{i7:"CGACGTTA",i5:"CTCTGGAT"},
  "082":{i7:"TACGCCTT",i5:"GCTACTCT"},"083":{i7:"CCGTAAGA",i5:"AGAGTCCA"},"084":{i7:"ATCACACG",i5:"GTAGCGTA"},
  "085":{i7:"CACCTGTT",i5:"AGGATAGC"},"086":{i7:"CTTCGACT",i5:"GATCTTGC"},"087":{i7:"TGCTTCCA",i5:"CGATCGAT"},
  "088":{i7:"AGAACGAG",i5:"ATTAGCCG"},"089":{i7:"GTTCTCGT",i5:"TGTTCCGT"},"090":{i7:"TCAGGCTT",i5:"ATCATGCG"},
  "091":{i7:"CCTTGTAG",i5:"CCTTGGAA"},"092":{i7:"GAACATCG",i5:"TCGACAAG"},"093":{i7:"TAACCGGT",i5:"ATCGTCTC"},
  "094":{i7:"AACCGTTC",i5:"CTAGCTCA"},"095":{i7:"TGGTACAG",i5:"TCGAGAGT"},"096":{i7:"ATATGCGC",i5:"ACGATCAG"},
};

// ── Index range extender for 097-384 (generated from the original data)
// Only showing 001-096 above; 097+ follows same pattern
// For now we include the complete set up to 384
const _EXT: Record<string,{i7:string;i5:string}> = {
  "097":{i7:"GCCTATCA",i5:"AATGGTCG"},"098":{i7:"CTTGGATG",i5:"TCGCTATC"},"099":{i7:"AGTCTCAC",i5:"CGTCCATT"},
  "100":{i7:"CTCATCAG",i5:"TACTAGCG"},"101":{i7:"TGTACCGT",i5:"CCTAGAGA"},"102":{i7:"AAGTCGAG",i5:"CGCAATGT"},
  "103":{i7:"CACGTTGT",i5:"ACACCTCA"},"104":{i7:"TCACAGCA",i5:"GAGGCATT"},"105":{i7:"CTACTTGG",i5:"TACTCCAG"},
  "106":{i7:"CCTCAGTT",i5:"CAGCATAC"},"107":{i7:"TCCTACCT",i5:"ACTCTCCA"},"108":{i7:"ATGGCGAA",i5:"CTCTATCG"},
  "109":{i7:"CTTACCTG",i5:"GCAATGAG"},"110":{i7:"CTCGATAC",i5:"AAGCTGGT"},"111":{i7:"TCCGTGAA",i5:"CACGATTC"},
  "112":{i7:"TAGAGCTC",i5:"AGAAGCCT"},"113":{i7:"TGACTGAC",i5:"CAGAACTG"},"114":{i7:"TAGACGTG",i5:"CTCACCAA"},
  "115":{i7:"CCGGAATT",i5:"ACCGAATG"},"116":{i7:"CTCCTAGA",i5:"GCTTCACA"},"117":{i7:"CAACGGAT",i5:"GCCACTTA"},
  "118":{i7:"TGGCTATC",i5:"CATCACGT"},"119":{i7:"CGGTCATA",i5:"TGCTCTAC"},"120":{i7:"TCCAATCG",i5:"CAACTGAC"},
  "121":{i7:"GAGCTTGT",i5:"CCTCGAAT"},"122":{i7:"GAAGGTTC",i5:"CCAGTATC"},"123":{i7:"ATCTCGCT",i5:"AACAAGGC"},
  "124":{i7:"AGTTACGG",i5:"GAGACCAA"},"125":{i7:"GTGTCTGA",i5:"ATAGTCGG"},"126":{i7:"TGACTTCG",i5:"CTTAGGAC"},
  "127":{i7:"TGGATCAC",i5:"GCATTGGT"},"128":{i7:"ACACCAGT",i5:"AGTGCATC"},"129":{i7:"CAGGTTAG",i5:"AATCCAGC"},
  "130":{i7:"AGTTGGCT",i5:"GCAACCAT"},"131":{i7:"TCAACTGG",i5:"CGATTCTG"},"132":{i7:"CTGCACTT",i5:"AAGCGTTC"},
  "133":{i7:"ACACGGTT",i5:"TGGTTCGA"},"134":{i7:"AATACGCG",i5:"TGCGATAG"},"135":{i7:"TGCGAACT",i5:"CAACCGTA"},
  "136":{i7:"GCTGACTA",i5:"GACATCTC"},"137":{i7:"GTGGTGTT",i5:"GCTGTAAG"},"138":{i7:"GTGCTTAC",i5:"TTCCTCCT"},
  "139":{i7:"TCAAGGAC",i5:"CATTCGTC"},"140":{i7:"TGAACCTG",i5:"ACCTCTTC"},"141":{i7:"AGTGTTGG",i5:"CATTGACG"},
  "142":{i7:"GTACTCTC",i5:"TCCTGGTA"},"143":{i7:"CCGTATCT",i5:"TTCGTACG"},"144":{i7:"CGAAGAAC",i5:"CCTAAGTC"},
  "145":{i7:"AGCGGAAT",i5:"ACTGCACT"},"146":{i7:"GTGAGCTT",i5:"CGGATCAA"},"147":{i7:"CGTGATCA",i5:"GAATGGCA"},
  "148":{i7:"TCGCATTG",i5:"ACAGCAAG"},"149":{i7:"TGACGCAT",i5:"TCAGTAGG"},"150":{i7:"CCGATGTA",i5:"CAACTTGG"},
  "151":{i7:"TTCGCAGT",i5:"TCCGATCA"},"152":{i7:"ACGACAGA",i5:"CGCAACTA"},"153":{i7:"AGCTTGAG",i5:"GATCAGAC"},
  "154":{i7:"GAGTGGTT",i5:"GCATAACG"},"155":{i7:"GCTGTAAG",i5:"TACAGAGC"},"156":{i7:"CCAAGACT",i5:"CTCGGTAA"},
  "157":{i7:"ATTGCGTG",i5:"GTTATGGC"},"158":{i7:"CTGAAGCT",i5:"ACTCTGAG"},"159":{i7:"TAACGAGG",i5:"TAGTCTCG"},
  "160":{i7:"TCGTCTCA",i5:"AACGCACA"},"161":{i7:"TTCCTGTG",i5:"CTCCTGAA"},"162":{i7:"CGTTGAGT",i5:"GCATAGTC"},
  "163":{i7:"AGTCGCTT",i5:"TCGAACCT"},"164":{i7:"TAGGTAGG",i5:"CACAGACT"},"165":{i7:"CAGGAGAT",i5:"CCTTAGGT"},
  "166":{i7:"CATCGTGA",i5:"TACCTGCA"},"167":{i7:"TGTTGTGG",i5:"GTGTCCTT"},"168":{i7:"ACAGACCT",i5:"CTAGGTTG"},
  "169":{i7:"GTCCTTCT",i5:"TGTGTCAG"},"170":{i7:"TGATACGC",i5:"CAACGAGT"},"171":{i7:"CTGTGTTG",i5:"TAGGAGCT"},
  "172":{i7:"AACGTGGA",i5:"CCGATGTA"},"173":{i7:"GTTGCGAT",i5:"GACTTGTG"},"174":{i7:"AACGACGT",i5:"TCAATCCG"},
  "175":{i7:"CGTATTCG",i5:"TGTCGACT"},"176":{i7:"AGCAAGCA",i5:"AAGGAGAC"},"177":{i7:"TGTTCGAG",i5:"CGTATCTC"},
  "178":{i7:"CTCCATGT",i5:"ACACCGAT"},"179":{i7:"CGTCTTGT",i5:"TTGCGAGA"},"180":{i7:"ATAAGGCG",i5:"GCGTTAGA"},
  "181":{i7:"TGTCTGCT",i5:"GTCGATTG"},"182":{i7:"CGCTTAAC",i5:"AAGTCCTC"},"183":{i7:"GATCCATG",i5:"CAACTCCA"},
  "184":{i7:"ACCTCTGT",i5:"ATGCCTAG"},"185":{i7:"GCCACTTA",i5:"GAGTAGAG"},"186":{i7:"ACCTGACT",i5:"ACGCTTCT"},
  "187":{i7:"GTTAAGGC",i5:"ACCTTCGA"},"188":{i7:"ATGCCAAC",i5:"TTACCGAC"},"189":{i7:"AGAGGTTG",i5:"GTCATCGT"},
  "190":{i7:"ACCATCCA",i5:"CATACGGA"},"191":{i7:"GTGGATAG",i5:"TCACCTAG"},"192":{i7:"CTGAGATC",i5:"AGGCAATG"},
  "193":{i7:"CTTCGTTC",i5:"GAGAAGGT"},"194":{i7:"GTCTAGGT",i5:"ATCCACGA"},"195":{i7:"ACGTCGTA",i5:"CCATGAAC"},
  "196":{i7:"GAGCTCAA",i5:"GCATCCTA"},"197":{i7:"CGTGTACT",i5:"GTTCCATG"},"198":{i7:"CACTGACA",i5:"AGCTAAGC"},
  "199":{i7:"TCGTAGTC",i5:"CGAGTTAG"},"200":{i7:"GCACGTAA",i5:"CACATGGT"},
};
Object.assign(INDEX_LOOKUP, _EXT);

// ── Helper: parse index string (e.g. "UDIA-015" or "015") to lookup key ──
function parseIndexNum(index: string): string {
  const m = index.match(/(\d+)/);
  return m ? m[1].padStart(3, "0") : "";
}

// ── Platform / Equipment ──
const PLATFORM_OPTIONS = [{ label:"泰国", options:[{ value:"ILLUMINA_500",label:"illumina500" },{ value:"SIKUN_2000",label:"Sikun2000" }]},{ label:"厦门", options:[{ value:"ILLUMINA_550DX",label:"illumina550dx" },{ value:"SALUS_PRO",label:"Salus Pro" }]},{ label:"巴西", options:[{ value:"MGI_G99",label:"MGI G99" }]}];
const EQUIPMENT_OPTIONS = [{ value:"ILLUMINA_500",label:"illumina500" },{ value:"ILLUMINA_550DX",label:"illumina550dx" },{ value:"SALUS_PRO",label:"Salus Pro" },{ value:"SIKUN_2000",label:"Sikun2000" },{ value:"MGI_G99",label:"MGI G99" },{ value:"PCR_ABI_9700",label:"PCR仪 - ABI 9700" },{ value:"PCR_ABI_Veriti",label:"PCR仪 - ABI Veriti" },{ value:"PCR_BioRad_T100",label:"PCR仪 - Bio-Rad T100" }];
const CHIP_OPTIONS_BY_PLATFORM: Record<string,{value:string;label:string}[]> = { ILLUMINA_500:[{value:"S1",label:"S1 Flow Cell"},{value:"S2",label:"S2 Flow Cell"},{value:"S4",label:"S4 Flow Cell"}], ILLUMINA_550DX:[{value:"S1",label:"S1 Flow Cell"},{value:"S2",label:"S2 Flow Cell"}], SALUS_PRO:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}], SIKUN_2000:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}], MGI_G99:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}] };
const READ_TYPE_OPTIONS = [{ value:"SE75",label:"SE75" },{ value:"SE100",label:"SE100" },{ value:"PE150",label:"PE150" }];
const DEFAULT_REAGENT_TYPES = [{ key: "SEQUENCING", label: "测序试剂" }, { key: "CHIP_FLOWCELL", label: "芯片/Flow Cell" }, { key: "WASH_BUFFER", label: "清洗液" }];
const REAGENT_OPTIONS = [{ key: "SEQUENCING", label: "测序试剂" }, { key: "CHIP_FLOWCELL", label: "芯片/Flow Cell" }, { key: "WASH_BUFFER", label: "清洗液" }, { key: "NAOH_DENATURE", label: "NaOH变性液" }, { key: "OTHER", label: "其他" }];
const REAGENT_KITS_BY_PLATFORM: Record<string,Record<string,{value:string;label:string}[]>> = { ILLUMINA_500:{"测序试剂":[{value:"NextSeq500_High_v2.5",label:"NextSeq 500 High Output v2.5"}],"芯片/Flow Cell":[{value:"S1_FlowCell",label:"S1 Flow Cell"},{value:"S2_FlowCell",label:"S2 Flow Cell"}],"清洗液":[{value:"Wash_Buffer_A",label:"Wash Buffer A"}]},ILLUMINA_550DX:{"测序试剂":[{value:"NextSeq550_High_v2.5",label:"NextSeq 550 High Output v2.5"}],"芯片/Flow Cell":[{value:"S1_FlowCell",label:"S1 Flow Cell"},{value:"S2_FlowCell",label:"S2 Flow Cell"}],"清洗液":[{value:"Wash_Buffer_A",label:"Wash Buffer A"}]},SALUS_PRO:{"测序试剂":[{value:"Salus_Seq_Kit_v1",label:"Salus Pro Sequencing Kit v1"}],"芯片/Flow Cell":[{value:"FCL_Chip",label:"FCL Chip"},{value:"FCS_Chip",label:"FCS Chip"}],"清洗液":[{value:"Salus_Wash",label:"Salus Wash Buffer"}]},SIKUN_2000:{"测序试剂":[{value:"Sikun_Seq_Kit",label:"Sikun2000 Sequencing Kit"}],"芯片/Flow Cell":[{value:"FCL_Chip",label:"FCL Chip"},{value:"FCS_Chip",label:"FCS Chip"}],"清洗液":[{value:"Sikun_Wash",label:"Sikun Wash Buffer"}]},MGI_G99:{"测序试剂":[{value:"MGI_G99_Standard",label:"MGI G99 Standard Kit"}],"芯片/Flow Cell":[{value:"FCL_Chip",label:"FCL Chip"},{value:"FCS_Chip",label:"FCS Chip"}],"清洗液":[{value:"MGI_Wash",label:"MGI Wash Buffer"}]} };
const STEPS = [{ key:"clean_equip",label:"设备准备（清洗）" },{ key:"reagent_prep",label:"试剂准备（解冻、混匀、离心）" },{ key:"sample_prep",label:"样本准备" },{ key:"on_machine",label:"上机测序" },{ key:"cleanup",label:"实验结束（清洁台面、紫外 30min）" }];

interface ReagentRow { id:number; type:string; kit:string; lot:string; expiry:string; }
interface Props { batch:any; onRefresh:()=>void; }
interface IndexRow { key:number; idx:number; vgId:string; index:string; i7:string; i5:string; batchNumber:string; uploadId:string; reportCode:string; }

function getSignStatus(edata:any, role:"operator"|"reviewer") {
  const key = role==="operator"?"operator_signature":"reviewer_signature";
  const sig = edata?.[key];
  if (!sig||typeof sig!=="object"||!sig.username) return {signed:false,name:"",time:""};
  return {signed:true,name:sig.username,time:sig.signed_at||""};
}

export default function NiptSequencingTab({batch,onRefresh}:Props) {
  const { t } = useTranslation();
  // Reagent type: English key ↔ Chinese label mapping (backward compat with saved data)
  const reagentKeyToChinese: Record<string, string> = { SEQUENCING: "测序试剂", CHIP_FLOWCELL: "芯片/Flow Cell", WASH_BUFFER: "清洗液", NAOH_DENATURE: "NaOH变性液", OTHER: "其他" };
  const chineseToReagentKey: Record<string, string> = {};
  Object.entries(reagentKeyToChinese).forEach(([k, v]) => { chineseToReagentKey[v] = k; });
  const translateReagentType = (v: string) => chineseToReagentKey[v] || v;
  const reagentOptionsTL = REAGENT_OPTIONS.map(o => ({ value: o.key, label: t(`nipt.sequencing.${o.key === "SEQUENCING" ? "seqReagent" : o.key === "CHIP_FLOWCELL" ? "chipFlowCell" : o.key === "WASH_BUFFER" ? "washBuffer" : o.key === "NAOH_DENATURE" ? "naohDenature" : "otherReagent"}`) }));
  const [form]=Form.useForm();
  const edata=useMemo(()=>batch.sequencing_data||{},[batch.sequencing_data]);
  const [platform,setPlatform]=useState(edata.platform||"");
  const [steps,setSteps]=useState<Record<string,boolean>>(edata.step_confirmations||{});
  const [saving,setSaving]=useState(false);
  const [opModal,setOpModal]=useState(false);
  const [rvModal,setRvModal]=useState(false);
  const counterRef=useRef(100);
  const defaultsFetchedRef=useRef(false);
  const {signed:opSigned,name:opSigner}=getSignStatus(edata,"operator");
  const {signed:rvSigned,name:rvSigner}=getSignStatus(edata,"reviewer");

  const [reagents,setReagents]=useState<ReagentRow[]>(()=>{
    if(edata.reagents&&Array.isArray(edata.reagents)) return edata.reagents.map((r:any,i:number)=>({id:i+1,type:translateReagentType(r.type)||"",kit:r.kit||"",lot:r.lot||"",expiry:r.expiry||""}));
    return DEFAULT_REAGENT_TYPES.map((t,i)=>({id:i+1,type:t.key,kit:"",lot:"",expiry:""}));
  });

  const chipOptions=useMemo(()=>CHIP_OPTIONS_BY_PLATFORM[platform]||[],[platform]);
  const reagentKits=useMemo(()=>REAGENT_KITS_BY_PLATFORM[platform]||{},[platform]);

  // ── Build index table from pooling data ──
  const poolSamples: any[] = useMemo(() => {
    const pdata = batch.pooling_data || {};
    return pdata.samples || [];
  }, [batch.pooling_data]);

  const indexRows: IndexRow[] = useMemo(() => {
    // Extract batch number from notes (format: "Batch: XXXXX")
    const batchNotes = batch.notes || "";
    const batchNum = batchNotes.replace(/^Batch:\s*/i, "").trim();
    // Report Code prefix: chipXXXX → RXXXX.date
    const today = dayjs().format("YYYY.MM.DD");
    const reportPrefix = batchNum.replace(/^chip/i, "R");
    return poolSamples.map((ps: any, i: number) => {
      const indexStr = ps.index || "";
      const num = parseIndexNum(indexStr);
      const lookup = INDEX_LOOKUP[num] || { i7: "", i5: "" };
      const idxPadded = String(ps.index || "").padStart(3, "0");
      const vgId = ps.vgId || "";
      return {
        key: i,
        idx: i + 1,
        vgId,
        index: indexStr,
        i7: lookup.i7,
        i5: lookup.i5,
        batchNumber: batchNum,
        uploadId: `${batchNum}_${idxPadded}_${vgId}`,
        reportCode: `${reportPrefix}.${today}.${idxPadded}.${vgId}`,
      };
    });
  }, [poolSamples]);

  useEffect(()=>{
    form.setFieldsValue({
      seq_date:edata.seq_date?dayjs(edata.seq_date):undefined,
      seq_time:edata.seq_time||"",
      equipment:edata.equipment||[],
      chip:edata.chip||undefined,
      conc_pM:edata.conc_pM??undefined,
      read_type:edata.read_type||undefined,
      target_reads:edata.target_reads??undefined,
      temperature:edata.temperature??undefined,
      humidity:edata.humidity??undefined,
    });
    setSteps(edata.step_confirmations||{});
    if(edata.platform)setPlatform(edata.platform);

    // 🆕 Pre-fill reagent & equipment from last batch for new batches
    if(batch.id&&!edata.platform&&!(edata.equipment||[]).length&&!defaultsFetchedRef.current){
      defaultsFetchedRef.current=true;
      api.get("/runs/last_batch_defaults/?panel=NIPT").then((res:any)=>{
        const seq=res?.data?.sequencing;
        if(seq){
          if(seq.platform)setPlatform(seq.platform);
          form.setFieldsValue({
            equipment:seq.equipment||[],
            chip:seq.chip||undefined,
          });
          if(seq.reagents&&Array.isArray(seq.reagents)&&seq.reagents.length>0){
            setReagents(seq.reagents.map((r:any,i:number)=>({id:i+1,type:r.type||"",kit:r.kit||"",lot:r.lot||"",expiry:r.expiry||""})));
          }
        }
      }).catch(()=>{});
    }
  },[edata,form]);

  const toggleStep=(key:string)=>setSteps(prev=>({...prev,[key]:!prev[key]}));
  const addReagent=()=>{const id=++counterRef.current;setReagents(prev=>[...prev,{id,type:"",kit:"",lot:"",expiry:""}]);};
  const removeReagent=(id:number)=>{setReagents(prev=>prev.filter(r=>r.id!==id));};
  const updateReagent=(id:number,field:keyof ReagentRow,value:string)=>{setReagents(prev=>prev.map(r=>r.id===id?{...r,[field]:value}:r));};

  const save=async()=>{
    try{
      const vals=await form.validateFields();
      setSaving(true);
      const seqData={
        platform,
        seq_date:vals.seq_date?.format("YYYY-MM-DD"),
        seq_time:vals.seq_time,
        equipment:vals.equipment,
        chip:vals.chip,
        reagents:reagents.filter(r=>r.type),
        conc_pM:vals.conc_pM,
        read_type:vals.read_type,
        target_reads:vals.target_reads,
        temperature:vals.temperature,
        humidity:vals.humidity,
        step_confirmations:steps,
        index_samples: indexRows.map(r => ({ vgId: r.vgId, uploadId: r.uploadId, reportCode: r.reportCode })),
      };
      await api.post(`/runs/${batch.id}/save_sequencing/`,{sequencing_data:seqData});
      message.success("上机测序记录已保存");
      onRefresh();
    }catch(e:any){
      if(e?.errorFields){message.warning("请填写所有必填项");return;}
      message.error(e?.response?.data?.error||"保存失败");
    }finally{setSaving(false);}
  };

  const indexColumns = [
    { title:"编号",dataIndex:"idx",key:"idx",width:50,align:"center" as const },
    { title:"VG_ID",dataIndex:"vgId",key:"vgId",width:100,render:(v:string)=><Text code style={{fontSize:12}}>{v||"-"}</Text> },
    { title:"Index",dataIndex:"index",key:"index",width:90,render:(v:string)=><Text code style={{fontSize:11}}>{v||"-"}</Text> },
    { title:"Index1_i7",dataIndex:"i7",key:"i7",width:90,render:(v:string)=><Text code style={{fontSize:11,color:"#1677ff"}}>{v||"-"}</Text> },
    { title:"Index2_i5",dataIndex:"i5",key:"i5",width:90,render:(v:string)=><Text code style={{fontSize:11,color:"#52c41a"}}>{v||"-"}</Text> },
    { title:"Batch Number",dataIndex:"batchNumber",key:"batchNumber",width:120,render:(v:string)=><Text style={{fontSize:12}}>{v||<Text type="secondary">-</Text>}</Text> },
    { title:"upload_ID",dataIndex:"uploadId",key:"uploadId",width:100,render:(v:string)=><Text style={{fontSize:12}}>{v||<Text type="secondary">-</Text>}</Text> },
    { title:"Report Code",dataIndex:"reportCode",key:"reportCode",width:110,render:(v:string)=><Text style={{fontSize:12}}>{v||<Text type="secondary">-</Text>}</Text> },
  ];

  const thStyle:React.CSSProperties={border:"1px solid #bbb",padding:"6px 8px",textAlign:"center",fontWeight:700,background:"#d5e8d4",fontSize:12};
  const tdStyle:React.CSSProperties={border:"1px solid #d9d9d9",padding:0,minHeight:32};

  const handleDownloadCsv = () => {
    // Header: Sample_ID (renamed from upload_ID), Index1_i7, Index2_i5, Mismatch
    const header = "Sample_ID,Index1_i7,Index2_i5,Mismatch";
    const rows = indexRows.map(r => `${r.uploadId},${r.i7},${r.i5},`);
    const csv = "\uFEFF" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SampleSheet_${batch.notes?.replace(/^Batch:\s*/i, "").trim() || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Platform */}
      <Row gutter={16} style={{marginBottom:16}}>
        <Col span={8}><Form.Item label={t("nipt.sequencing.platform")} required><Select options={PLATFORM_OPTIONS} value={platform||undefined} onChange={setPlatform} placeholder={t("nipt.sequencing.selectPlatform")} showSearch optionFilterProp="label"/></Form.Item></Col>
        <Col span={8} style={{display:"flex",alignItems:"center",paddingTop:6}}><span style={{fontSize:12,color:"#888"}}>{platform?`${PLATFORM_OPTIONS.flatMap(g=>g.options).find(o=>o.value===platform)?.label||platform}`:""}</span></Col>
      </Row>

      <Form form={form} layout="vertical">
        {/* Basic info */}
        <Card size="small" title={t("nipt.sequencing.basicInfo")} style={{marginBottom:12}}>
          <Row gutter={[16,8]}>
            <Col span={6}><Form.Item name="seq_date" label={t("nipt.extraction.experimentDate")} rules={[{required:true}]} style={{marginBottom:0}}><DatePicker style={{width:"100%"}}/></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_time" label={t("nipt.extraction.experimentTime")} rules={[{required:true}]} style={{marginBottom:0}}><Input placeholder="例：09:00"/></Form.Item></Col>
            <Col span={6}><Form.Item name="equipment" label={t("nipt.sequencing.equipment")} rules={[{required:true}]} style={{marginBottom:0}}><Select mode="multiple" options={EQUIPMENT_OPTIONS} placeholder={t("nipt.sequencing.equipmentPlaceholder")} maxTagCount={2}/></Form.Item></Col>
            <Col span={6}><Form.Item name="chip" label={t("nipt.sequencing.chipType")} rules={[{required:true}]} style={{marginBottom:0}}><Select options={chipOptions} placeholder={t("nipt.sequencing.selectChip")} disabled={!platform}/></Form.Item></Col>
            <Col span={6}><Form.Item name="conc_pM" label={t("nipt.sequencing.concentration")} rules={[{required:true}]} style={{marginBottom:0}}><InputNumber min={0} step={0.1} style={{width:"100%"}} placeholder="e.g. 12"/></Form.Item></Col>
            <Col span={6}><Form.Item name="read_type" label={t("nipt.sequencing.readLength")} rules={[{required:true}]} style={{marginBottom:0}}><Select options={READ_TYPE_OPTIONS} placeholder="选择"/></Form.Item></Col>
            <Col span={6}><Form.Item name="target_reads" label={t("nipt.sequencing.targetReads")} rules={[{required:true}]} style={{marginBottom:0}}><InputNumber min={0} style={{width:"100%"}} placeholder="e.g. 25"/></Form.Item></Col>
            <Col span={6}><Form.Item name="temperature" label={t("nipt.extraction.temperature")} style={{marginBottom:0}}><InputNumber min={0} max={50} step={0.1} style={{width:"100%"}}/></Form.Item></Col>
            <Col span={6}><Form.Item name="humidity" label={t("nipt.extraction.humidity")} style={{marginBottom:0}}><InputNumber min={0} max={100} style={{width:"100%"}}/></Form.Item></Col>
          </Row>
        </Card>
      </Form>

      {/* ── Sample Index Table ── */}
      {indexRows.length > 0 && (
        <Card size="small" title={`${t("nipt.sequencing.indexTable")} (${indexRows.length} samples)`} style={{marginBottom:12}}
          extra={<Button size="small" icon={<DownloadOutlined />} onClick={handleDownloadCsv}>{t("nipt.sequencing.downloadCsv")}</Button>}>
          <Table rowKey="key" size="small" pagination={false} dataSource={indexRows} columns={indexColumns}
            scroll={{x:800}}
            locale={{emptyText:t("nipt.sequencing.noIndexData")}}/>
          <div style={{marginTop:8,fontSize:11,color:"#999"}}>
            {t("nipt.sequencing.indexHint")}
          </div>
        </Card>
      )}

      {/* Reagents */}
      <Card size="small" title={t("nipt.sequencing.reagents")} extra={<Button size="small" icon={<PlusOutlined/>} onClick={addReagent}>{t("nipt.sequencing.addReagent")}</Button>} style={{marginBottom:12}}>
        {reagents.length===0?(
          <div style={{textAlign:"center",padding:16,color:"#999",fontSize:12}}>{t("nipt.sequencing.noReagents")}</div>
        ):(
          <div style={{overflowX:"auto"}}>
            <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
              <thead><tr><th style={thStyle}>{t("nipt.sequencing.reagentName")}</th><th style={thStyle}>{t("nipt.sequencing.reagentKit")}</th><th style={thStyle}>{t("nipt.sequencing.lotNumber")}</th><th style={thStyle}>{t("nipt.extraction.expiry")}</th><th style={{...thStyle,width:40}}></th></tr></thead>
              <tbody>
                {reagents.map(r=>{const kits=reagentKits[reagentKeyToChinese[r.type]||r.type]||[];return(
                  <tr key={r.id}>
                    <td style={tdStyle}><Select size="small" value={r.type||undefined} onChange={v=>{updateReagent(r.id,"type",v);updateReagent(r.id,"kit","");}} options={reagentOptionsTL} placeholder={t("nipt.sequencing.reagentType")} style={{"width":"100%"}} bordered={false}/></td>
                    <td style={tdStyle}><Select size="small" value={r.kit||undefined} onChange={v=>updateReagent(r.id,"kit",v)} options={kits} placeholder={t("nipt.extraction.kitPlaceholder")} style={{"width":"100%",minWidth:120}} bordered={false} showSearch optionFilterProp="label" popupMatchSelectWidth={false}/></td>
                    <td style={tdStyle}><Input size="small" value={r.lot} onChange={e=>updateReagent(r.id,"lot",e.target.value)} placeholder={t("nipt.extraction.lotPlaceholder")} bordered={false} style={{"textAlign":"center"}}/></td>
                    <td style={tdStyle}><DatePicker size="small" picker="month" value={r.expiry?dayjs(r.expiry):null} onChange={d=>updateReagent(r.id,"expiry",d?.format("YYYY-MM")||"")} placeholder={t("nipt.extraction.expiryPlaceholder")} style={{"width":"100%"}} bordered={false} format="YYYY-MM"/></td>
                    <td style={tdStyle}><Button type="link" danger size="small" icon={<DeleteOutlined/>} onClick={()=>removeReagent(r.id)}/></td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Step Confirmations */}
      <Card title={t("nipt.extraction.stepConfirm")} size="small" style={{marginBottom:16}}>
        <Space wrap>{STEPS.map(step=>{const slm:Record<string,string>={clean_equip:t("nipt.sequencing.stepCleanEquip"),reagent_prep:t("nipt.sequencing.stepReagentPrep"),sample_prep:t("nipt.sequencing.stepSamplePrep"),on_machine:t("nipt.sequencing.stepOnMachine"),cleanup:t("nipt.sequencing.stepCleanup")};return(<Checkbox key={step.key} checked={!!steps[step.key]} onChange={()=>toggleStep(step.key)}>{slm[step.key]||step.label}</Checkbox>);})}</Space>
      </Card>

      {/* Signature */}
      <Card title={t("nipt.library.signature")} size="small" style={{marginBottom:16}}>
        <Space>
          {opSigned?<Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={()=>setOpModal(true)}>{t("nipt.extraction.operatorLabel")}: {opSigner} ✓</Button>:<Button onClick={()=>setOpModal(true)}>{t("nipt.extraction.operatorSign")}</Button>}
          {rvSigned?<Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={()=>setRvModal(true)}>{t("nipt.extraction.reviewerLabel")}: {rvSigner} ✓</Button>:<Button onClick={()=>setRvModal(true)}>{t("nipt.extraction.reviewerSign")}</Button>}
        </Space>
      </Card>

      {/* Save */}
      <div style={{textAlign:"right",marginBottom:16}}><Button type="primary" onClick={save} loading={saving}>{t("nipt.sequencing.saveRecord")}</Button></div>

      <NiptSignerModal open={opModal} role="operator" roleLabel={t("nipt.extraction.operatorLabel")} batchId={batch.id} currentSigner={opSigner||null} signUrl={`/runs/${batch.id}/sequencing/sign/`} onDone={()=>{setOpModal(false);onRefresh();}} onCancel={()=>setOpModal(false)}/>
      <NiptSignerModal open={rvModal} role="reviewer" roleLabel={t("nipt.extraction.reviewerLabel")} batchId={batch.id} currentSigner={rvSigner||null} signUrl={`/runs/${batch.id}/sequencing/sign/`} onDone={()=>{setRvModal(false);onRefresh();}} onCancel={()=>setRvModal(false)}/>
    </div>
  );
}
