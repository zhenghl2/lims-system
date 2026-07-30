// NipptHybSeq.tsx — Hybridization & Sequencing (NIPT-style + Mix dilution table)
import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Table, Button, Tag, Modal, message, Typography, Input, InputNumber,
  Space, Popconfirm, Select, Checkbox, Form, DatePicker, TimePicker } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined } from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";
const { Text, Title } = Typography;

const INDEX_LOOKUP: Record<string,{i7:string,i5:string}> = {
  "001":{i7:"CTGATCGT",i5:"GCGCATAT"},"002":{i7:"ACTCTCGA",i5:"CTGTACCA"},"003":{i7:"TGAGCTAG",i5:"GAACGGTT"},"004":{i7:"GAGACGAT",i5:"ACCGGTTA"},"005":{i7:"CTTGTCGA",i5:"CGATGTTC"},"006":{i7:"TTCCAAGG",i5:"CTACAAGG"},"007":{i7:"CGCATGAT",i5:"AAGCCTGA"},"008":{i7:"ACGGAACA",i5:"ACGAGAAC"},"009":{i7:"CGGCTAAT",i5:"CTCGTTCT"},"010":{i7:"ATCGATCG",i5:"TGGAAGCA"},
  "011":{i7:"GCAAGATC",i5:"AGTCGAAG"},"012":{i7:"GCTATCCT",i5:"AACAGGTG"},"013":{i7:"TACGCTAC",i5:"CGTGTGAT"},"014":{i7:"TGGACTCT",i5:"TCTTACGG"},"015":{i7:"AGAGTAGC",i5:"AAGGCGTA"},"016":{i7:"ATCCAGAG",i5:"TAACGTCG"},"017":{i7:"GACGATCT",i5:"TCGTGCAT"},"018":{i7:"AACTGAGC",i5:"CAATCAGG"},"019":{i7:"CTTAGGAC",i5:"ACTCCTAC"},"020":{i7:"GTGCCATA",i5:"CTCCTAGT"},
  "021":{i7:"GAATCCGA",i5:"AGCTAGTG"},"022":{i7:"TCGCTGTT",i5:"CAAGTCGT"},"023":{i7:"TTCGTTGG",i5:"TACACACG"},"024":{i7:"AAGCACTG",i5:"AGGTCAAC"},"025":{i7:"CCTTGATC",i5:"GATGGAGT"},"026":{i7:"GTCGAAGA",i5:"CCACATTG"},"027":{i7:"ACCACGAT",i5:"GTCTGCAA"},"028":{i7:"GATTACCG",i5:"TTGGACTG"},"029":{i7:"GCACAACT",i5:"CTGAACGT"},"030":{i7:"GCGTCATT",i5:"CAGACGTT"},
  "031":{i7:"ATCCGGTA",i5:"GACCGATA"},"032":{i7:"CGTTGCAA",i5:"ATAGAGCG"},"033":{i7:"GTGAAGTG",i5:"GAGCAATC"},"034":{i7:"CATGGCTA",i5:"CACACATC"},"035":{i7:"ATGCCTGT",i5:"AGATTGCG"},"036":{i7:"CAACACCT",i5:"AGCTACCA"},"037":{i7:"TGTGACTG",i5:"AGCCTATC"},"038":{i7:"GTCATCGA",i5:"GATCCACT"},"039":{i7:"AGCACTTC",i5:"ACGTCCAA"},"040":{i7:"GAAGGAAG",i5:"GACGTCAT"},
  "041":{i7:"GTTGTTCG",i5:"CCAACTTC"},"042":{i7:"CGGTTGTT",i5:"GTGGTATG"},"043":{i7:"ACTGAGGT",i5:"GTCAACAG"},"044":{i7:"TGAAGACG",i5:"ACATGCCA"},"045":{i7:"GTTACGCA",i5:"ATGGCGAT"},"046":{i7:"AGCGTGTT",i5:"CTTCGCAA"},"047":{i7:"GATCGAGT",i5:"GACGAACT"},"048":{i7:"ACAGCTCA",i5:"TACTGCTC"},"049":{i7:"GAGCAGTA",i5:"TGAGCTGT"},"050":{i7:"AGTTCGTC",i5:"ACTCGATC"},
  "051":{i7:"TTGCGAAG",i5:"AACACGCT"},"052":{i7:"ATCGCCAT",i5:"TGCGTAAC"},"053":{i7:"TGGCATGT",i5:"CGTCTTCA"},"054":{i7:"CTGTTGAC",i5:"ACCTCAGT"},"055":{i7:"CATACCAC",i5:"AACAACCG"},"056":{i7:"GAAGTTGG",i5:"CGAACAAC"},"057":{i7:"ATGACGTC",i5:"CTTCCTTC"},"058":{i7:"TTGGACGT",i5:"GAAGTGCT"},"059":{i7:"AGTGGATC",i5:"TCGATGAC"},"060":{i7:"GATAGGCT",i5:"CAGTCACA"},
  "061":{i7:"TGGTAGCT",i5:"AGGTGTTG"},"062":{i7:"CGCAATCT",i5:"ACAGGCAT"},"063":{i7:"GATGTGTG",i5:"TAGCCATG"},"064":{i7:"GATTGCTC",i5:"CACTTCAC"},"065":{i7:"CGCTCTAT",i5:"TTGCAACG"},"066":{i7:"TATCGGTC",i5:"TACCGGAT"},"067":{i7:"AACGTCTG",i5:"AATGACGC"},"068":{i7:"ACGTTCAG",i5:"AGTTGTGC"},"069":{i7:"CAGTCCAA",i5:"CGGTAATC"},"070":{i7:"TTGCAGAC",i5:"ATCGTGGT"},
  "071":{i7:"CAATGTGG",i5:"TCTTCGAC"},"072":{i7:"ACTCCATC",i5:"GATCAAGG"},"073":{i7:"GTTGACCT",i5:"CAGTGCTT"},"074":{i7:"CGTGTGTA",i5:"CCAACGAA"},"075":{i7:"ACGACTTG",i5:"AACAGCGA"},"076":{i7:"CACTAGCT",i5:"TCGGATTC"},"077":{i7:"ACTAGGAG",i5:"TATGGCAC"},"078":{i7:"GTAGGAGT",i5:"GTCCTAAG"},"079":{i7:"CCTGATTG",i5:"GCTCAGTT"},"080":{i7:"ATGCACGA",i5:"AGATCGTC"},
  "081":{i7:"CGACGTTA",i5:"CTCTGGAT"},"082":{i7:"TACGCCTT",i5:"GCTACTCT"},"083":{i7:"CCGTAAGA",i5:"AGAGTCCA"},"084":{i7:"ATCACACG",i5:"GTAGCGTA"},"085":{i7:"CACCTGTT",i5:"AGGATAGC"},"086":{i7:"CTTCGACT",i5:"GATCTTGC"},"087":{i7:"TGCTTCCA",i5:"CGATCGAT"},"088":{i7:"AGAACGAG",i5:"ATTAGCCG"},"089":{i7:"GTTCTCGT",i5:"TGTTCCGT"},"090":{i7:"TCAGGCTT",i5:"ATCATGCG"},
  "091":{i7:"CCTTGTAG",i5:"CCTTGGAA"},"092":{i7:"GAACATCG",i5:"TCGACAAG"},"093":{i7:"TAACCGGT",i5:"ATCGTCTC"},"094":{i7:"AACCGTTC",i5:"CTAGCTCA"},"095":{i7:"TGGTACAG",i5:"TCGAGAGT"},"096":{i7:"ATATGCGC",i5:"ACGATCAG"},"097":{i7:"GCCTATCA",i5:"AATGGTCG"},"098":{i7:"CTTGGATG",i5:"TCGCTATC"},"099":{i7:"AGTCTCAC",i5:"CGTCCATT"},"100":{i7:"CTCATCAG",i5:"TACTAGCG"},
  "101":{i7:"TGTACCGT",i5:"CCTAGAGA"},"102":{i7:"AAGTCGAG",i5:"CGCAATGT"},"103":{i7:"CACGTTGT",i5:"ACACCTCA"},"104":{i7:"TCACAGCA",i5:"GAGGCATT"},"105":{i7:"CTACTTGG",i5:"TACTCCAG"},"106":{i7:"CCTCAGTT",i5:"CAGCATAC"},"107":{i7:"TCCTACCT",i5:"ACTCTCCA"},"108":{i7:"ATGGCGAA",i5:"CTCTATCG"},"109":{i7:"CTTACCTG",i5:"GCAATGAG"},"110":{i7:"CTCGATAC",i5:"AAGCTGGT"},
  "111":{i7:"TCCGTGAA",i5:"CACGATTC"},"112":{i7:"TAGAGCTC",i5:"AGAAGCCT"},"113":{i7:"TGACTGAC",i5:"CAGAACTG"},"114":{i7:"TAGACGTG",i5:"CTCACCAA"},"115":{i7:"CCGGAATT",i5:"ACCGAATG"},"116":{i7:"CTCCTAGA",i5:"GCTTCACA"},"117":{i7:"CAACGGAT",i5:"GCCACTTA"},"118":{i7:"TGGCTATC",i5:"CATCACGT"},"119":{i7:"CGGTCATA",i5:"TGCTCTAC"},"120":{i7:"TCCAATCG",i5:"CAACTGAC"},
  "121":{i7:"GAGCTTGT",i5:"CCTCGAAT"},"122":{i7:"GAAGGTTC",i5:"CCAGTATC"},"123":{i7:"ATCTCGCT",i5:"AACAAGGC"},"124":{i7:"AGTTACGG",i5:"GAGACCAA"},"125":{i7:"GTGTCTGA",i5:"ATAGTCGG"},"126":{i7:"TGACTTCG",i5:"CTTAGGAC"},"127":{i7:"TGGATCAC",i5:"GCATTGGT"},"128":{i7:"ACACCAGT",i5:"AGTGCATC"},"129":{i7:"CAGGTTAG",i5:"AATCCAGC"},"130":{i7:"AGTTGGCT",i5:"GCAACCAT"},
  "131":{i7:"TCAACTGG",i5:"CGATTCTG"},"132":{i7:"CTGCACTT",i5:"AAGCGTTC"},"133":{i7:"ACACGGTT",i5:"TGGTTCGA"},"134":{i7:"AATACGCG",i5:"TGCGATAG"},"135":{i7:"TGCGAACT",i5:"CAACCGTA"},"136":{i7:"GCTGACTA",i5:"GACATCTC"},"137":{i7:"GTGGTGTT",i5:"GCTGTAAG"},"138":{i7:"GTGCTTAC",i5:"TTCCTCCT"},"139":{i7:"TCAAGGAC",i5:"CATTCGTC"},"140":{i7:"TGAACCTG",i5:"ACCTCTTC"},
  "141":{i7:"AGTGTTGG",i5:"CATTGACG"},"142":{i7:"GTACTCTC",i5:"TCCTGGTA"},"143":{i7:"CCGTATCT",i5:"TTCGTACG"},"144":{i7:"CGAAGAAC",i5:"CCTAAGTC"},"145":{i7:"AGCGGAAT",i5:"ACTGCACT"},"146":{i7:"GTGAGCTT",i5:"CGGATCAA"},"147":{i7:"CGTGATCA",i5:"GAATGGCA"},"148":{i7:"TCGCATTG",i5:"ACAGCAAG"},"149":{i7:"TGACGCAT",i5:"TCAGTAGG"},"150":{i7:"CCGATGTA",i5:"CAACTTGG"},
  "151":{i7:"TTCGCAGT",i5:"TCCGATCA"},"152":{i7:"ACGACAGA",i5:"CGCAACTA"},"153":{i7:"AGCTTGAG",i5:"GATCAGAC"},"154":{i7:"GAGTGGTT",i5:"GCATAACG"},"155":{i7:"GCTGTAAG",i5:"TACAGAGC"},"156":{i7:"CCAAGACT",i5:"CTCGGTAA"},"157":{i7:"ATTGCGTG",i5:"GTTATGGC"},"158":{i7:"CTGAAGCT",i5:"ACTCTGAG"},"159":{i7:"TAACGAGG",i5:"TAGTCTCG"},"160":{i7:"TCGTCTCA",i5:"AACGCACA"},
  "161":{i7:"TTCCTGTG",i5:"CTCCTGAA"},"162":{i7:"CGTTGAGT",i5:"GCATAGTC"},"163":{i7:"AGTCGCTT",i5:"TCGAACCT"},"164":{i7:"TAGGTAGG",i5:"CACAGACT"},"165":{i7:"CAGGAGAT",i5:"CCTTAGGT"},"166":{i7:"CATCGTGA",i5:"TACCTGCA"},"167":{i7:"TGTTGTGG",i5:"GTGTCCTT"},"168":{i7:"ACAGACCT",i5:"CTAGGTTG"},"169":{i7:"GTCCTTCT",i5:"TGTGTCAG"},"170":{i7:"TGATACGC",i5:"CAACGAGT"},
  "171":{i7:"CTGTGTTG",i5:"TAGGAGCT"},"172":{i7:"AACGTGGA",i5:"CCGATGTA"},"173":{i7:"GTTGCGAT",i5:"GACTTGTG"},"174":{i7:"AACGACGT",i5:"TCAATCCG"},"175":{i7:"CGTATTCG",i5:"TGTCGACT"},"176":{i7:"AGCAAGCA",i5:"AAGGAGAC"},"177":{i7:"TGTTCGAG",i5:"CGTATCTC"},"178":{i7:"CTCCATGT",i5:"ACACCGAT"},"179":{i7:"CGTCTTGT",i5:"TTGCGAGA"},"180":{i7:"ATAAGGCG",i5:"GCGTTAGA"},
  "181":{i7:"TGTCTGCT",i5:"GTCGATTG"},"182":{i7:"CGCTTAAC",i5:"AAGTCCTC"},"183":{i7:"GATCCATG",i5:"CAACTCCA"},"184":{i7:"ACCTCTGT",i5:"ATGCCTAG"},"185":{i7:"GCCACTTA",i5:"GAGTAGAG"},"186":{i7:"ACCTGACT",i5:"ACGCTTCT"},"187":{i7:"GTTAAGGC",i5:"ACCTTCGA"},"188":{i7:"ATGCCAAC",i5:"TTACCGAC"},"189":{i7:"AGAGGTTG",i5:"GTCATCGT"},"190":{i7:"ACCATCCA",i5:"CATACGGA"},
  "191":{i7:"GTGGATAG",i5:"TCACCTAG"},"192":{i7:"CTGAGATC",i5:"AGGCAATG"},"193":{i7:"CTTCGTTC",i5:"GAGAAGGT"},"194":{i7:"GTCTAGGT",i5:"ATCCACGA"},"195":{i7:"ACGTCGTA",i5:"CCATGAAC"},"196":{i7:"GAGCTCAA",i5:"GCATCCTA"},"197":{i7:"CGTGTACT",i5:"GTTCCATG"},"198":{i7:"CACTGACA",i5:"AGCTAAGC"},"199":{i7:"TCGTAGTC",i5:"CGAGTTAG"},"200":{i7:"GCACGTAA",i5:"CACATGGT"},
  "201":{i7:"CGCTGCTC",i5:"GATCTGCC"},"202":{i7:"ACATAGGC",i5:"CGCTGATA"},"203":{i7:"TGTGGTAC",i5:"CATCTGCT"},"204":{i7:"CACCACTA",i5:"TGACCGTT"},"205":{i7:"CTGCGTAT",i5:"ACAGTTCG"},"206":{i7:"ACGGTCTT",i5:"AACTCGGA"},"207":{i7:"GATTGGAG",i5:"CGAGAGAA"},"208":{i7:"TGTCCAGA",i5:"GCCAGAAT"},"209":{i7:"CCAGTGTT",i5:"CTAGCAGT"},"210":{i7:"TGCACCAA",i5:"CCGTTATG"},
  "211":{i7:"TTGACAGG",i5:"GAAGACTG"},"212":{i7:"AGGCATAG",i5:"AAGAGGCA"},"213":{i7:"TAGCCGAA",i5:"GACACAGT"},"214":{i7:"TTGTCGGT",i5:"GCCAATAC"},"215":{i7:"CATCTACG",i5:"AAGCATCG"},"216":{i7:"GCATACAG",i5:"TCAGCCTT"},"217":{i7:"ACAGCAAC",i5:"TCCTGACT"},"218":{i7:"CTGGTTCT",i5:"GATACCTG"},"219":{i7:"TCGACATC",i5:"ATCGGAGA"},"220":{i7:"AACCTCCT",i5:"AGGCTGAA"},
  "221":{i7:"CAGCGATT",i5:"CTCTCAGA"},"222":{i7:"AGGTCACT",i5:"CGACCTAA"},"223":{i7:"GCAATTCG",i5:"AACCAGAG"},"224":{i7:"GCTTCTTG",i5:"TAGAACGC"},"225":{i7:"AACTGGTG",i5:"GAACGTGA"},"226":{i7:"CGGAATAC",i5:"ACCATCCT"},"227":{i7:"GCTTCGAA",i5:"AGGAACAC"},"228":{i7:"CAAGGTCT",i5:"GATGCTAC"},"229":{i7:"AACCTTGG",i5:"CAGATCCT"},"230":{i7:"CCATACGT",i5:"CTCTTGTC"},
  "231":{i7:"TGGTCCTT",i5:"AGCCGTAA"},"232":{i7:"ACCGCATA",i5:"ACAACAGC"},"233":{i7:"CCTTCCTT",i5:"CTTCGGTT"},"234":{i7:"TACACGCT",i5:"AGAGCAGA"},"235":{i7:"TGCGTAGA",i5:"TAGCTGAG"},"236":{i7:"AAGAGCCA",i5:"TGGTGAAG"},"237":{i7:"ATGGAAGG",i5:"GTACGATC"},"238":{i7:"GCCAGTAT",i5:"CACTGTAG"},"239":{i7:"CGTAGGTT",i5:"TCACTCGA"},"240":{i7:"CGAGTATG",i5:"TGCACTTG"},
  "241":{i7:"CAAGTGCA",i5:"CATACTCG"},"242":{i7:"TCGAGTGA",i5:"AACCTACG"},"243":{i7:"CTACAGTG",i5:"ATACTGGC"},"244":{i7:"GATCGTAC",i5:"CCTTCCAT"},"245":{i7:"CTTCACCA",i5:"TGGCTCTT"},"246":{i7:"CTCAGCTA",i5:"TCTACGCA"},"247":{i7:"TCTGCTCT",i5:"AGCGTGTA"},"248":{i7:"AACCGAAG",i5:"AAGGAAGG"},"249":{i7:"GCTGTTGT",i5:"TATGCGGT"},"250":{i7:"TTACGGCT",i5:"AAGGACCA"},
  "251":{i7:"GACAAGAG",i5:"ACGTATGG"},"252":{i7:"AGGATCTG",i5:"CCAAGGTT"},"253":{i7:"GTAGCATC",i5:"AGACCTTG"},"254":{i7:"GTGTTCCT",i5:"TTCGAAGC"},"255":{i7:"AGGATGGT",i5:"GTATTCCG"},"256":{i7:"TCACGTTC",i5:"CACCAGTT"},"257":{i7:"GCGTTCTA",i5:"CAAGAAGC"},"258":{i7:"CTCTGGTT",i5:"CGAATTGC"},"259":{i7:"TTAGGTCG",i5:"AGTGACCT"},"260":{i7:"TCTGAGAG",i5:"AATCGCTG"},
  "261":{i7:"TTCAGCCT",i5:"AGGAGGTT"},"262":{i7:"TCTCCGAT",i5:"GATGTCGA"},"263":{i7:"CAGGTATC",i5:"AGAACCAG"},"264":{i7:"AGTCAGGA",i5:"GTTGCTGT"},"265":{i7:"AAGGCTGA",i5:"CTGTATGC"},"266":{i7:"CGATGCTT",i5:"CGTAGATG"},"267":{i7:"GTATTGGC",i5:"ACCGACAA"},"268":{i7:"ACTGTGTC",i5:"TTCGGCTA"},"269":{i7:"TGCCTCTT",i5:"CTATGCCT"},"270":{i7:"CAGTCTTC",i5:"CCTGTCAA"},
  "271":{i7:"CATAACGG",i5:"TTGGTGCA"},"272":{i7:"ACTGCTAG",i5:"AACACTGG"},"273":{i7:"ATTCTGGC",i5:"TCTGGACA"},"274":{i7:"TTCTCTCG",i5:"CTCCAATC"},"275":{i7:"TCCGAGTT",i5:"AAGACCGT"},"276":{i7:"CGAACTGT",i5:"ATACGCAG"},"277":{i7:"AACGGTCA",i5:"TAGTGGTG"},"278":{i7:"AGCAGATG",i5:"GTACCACA"},"279":{i7:"TATCAGCG",i5:"GCCTATGT"},"280":{i7:"TCAGACGA",i5:"ACTGCTTG"},
  "281":{i7:"ACCATGTG",i5:"TTACGTGC"},"282":{i7:"CTAACTCG",i5:"GACTACGA"},"283":{i7:"GCTTAGCT",i5:"TGTCAGTG"},"284":{i7:"CATGGAAC",i5:"AGTACACG"},"285":{i7:"TAGGATGC",i5:"TTGAGCTC"},"286":{i7:"GTTCATGG",i5:"TACGACGT"},"287":{i7:"TCGTGGAT",i5:"ACCTAGAC"},"288":{i7:"ACCTTCTC",i5:"GAACGAAG"},"289":{i7:"CATTGCCT",i5:"GATCTCAG"},"290":{i7:"CTAGGTGA",i5:"CTATCCAC"},
  "291":{i7:"TCCGTATG",i5:"TGGATGGT"},"292":{i7:"ACGATGAC",i5:"CAACCTCT"},"293":{i7:"GTCGGTAA",i5:"GTTGGCAT"},"294":{i7:"TCGAAGGT",i5:"GCCTTAAC"},"295":{i7:"AGAAGCGT",i5:"AGTCAGGT"},"296":{i7:"CTCTACTC",i5:"TAAGTGGC"},"297":{i7:"CTAGGCAT",i5:"ACAGAGGT"},"298":{i7:"TGGAGTTG",i5:"CATGGATC"},"299":{i7:"GAGGACTT",i5:"GTTAAGCG"},"300":{i7:"CAATCGAC",i5:"AGCAGACA"},
  "301":{i7:"TCTAACGC",i5:"CGCCTTAT"},"302":{i7:"TCTCGCAA",i5:"ACAAGACG"},"303":{i7:"ATCGGTGT",i5:"ACATGGAG"},"304":{i7:"GAGATACG",i5:"CTCGAACA"},"305":{i7:"GTCTCCTT",i5:"TGCTTGCT"},"306":{i7:"AGTCGACA",i5:"CGAATACG"},"307":{i7:"CGGATTGA",i5:"ACGTCGTT"},"308":{i7:"CACAAGTC",i5:"ATCGCAAC"},"309":{i7:"TACATCGG",i5:"TCCACGTT"},"310":{i7:"AGCTCCTA",i5:"CAACACAG"},
  "311":{i7:"ACTCGTTG",i5:"GCGTATCA"},"312":{i7:"CTGACACA",i5:"AGAAGGAC"},"313":{i7:"CAACCTAG",i5:"AGGTCTGT"},"314":{i7:"AAGGACAC",i5:"CCACAACA"},"315":{i7:"TGCAGGTA",i5:"TCACGATG"},"316":{i7:"ACCTAAGG",i5:"ATCTCCTG"},"317":{i7:"AGTCTGTG",i5:"CCTACCTA"},"318":{i7:"AGGTTCGA",i5:"AAGCGACT"},"319":{i7:"GACTATGC",i5:"ACTCAACG"},"320":{i7:"TTCAGGAG",i5:"CACAGGAA"},
  "321":{i7:"TGTGCGTT",i5:"TGAGACGA"},"322":{i7:"CGAGACTA",i5:"CCTCGTTA"},"323":{i7:"CTCAGAGT",i5:"AGCTTCAG"},"324":{i7:"GCCATAAC",i5:"CACGCAAT"},"325":{i7:"TTACCGAG",i5:"AGTCTTGG"},"326":{i7:"GCTCTGTA",i5:"CTTACAGC"},"327":{i7:"CGTTATGC",i5:"AACCACTC"},"328":{i7:"GTCTGATC",i5:"CTCAAGCT"},"329":{i7:"TAGTTGCG",i5:"TCTGTCGT"},"330":{i7:"TGATCGGA",i5:"ACTGCGAA"},
  "331":{i7:"CCAAGTTG",i5:"TACATCGG"},"332":{i7:"CCTACTGA",i5:"ATGCGTCA"},"333":{i7:"CTTGCTGT",i5:"CAATGCGA"},"334":{i7:"TGCCATTC",i5:"TGATCACG"},"335":{i7:"TTGATCCG",i5:"AAGCTCAC"},"336":{i7:"AGTGCAGT",i5:"ATTCCGCT"},"337":{i7:"GACTTAGG",i5:"GTTCTTCG"},"338":{i7:"CGTACGAA",i5:"AGATACGG"},"339":{i7:"TACCAGGA",i5:"GAGAGTAC"},"340":{i7:"CGTCAATG",i5:"CCAACACT"},
  "341":{i7:"GAAGAGGT",i5:"CAGGTTCA"},"342":{i7:"GACGAATG",i5:"GTCCTTGA"},"343":{i7:"AGGAGGAA",i5:"GTAAGCAC"},"344":{i7:"CTTACAGC",i5:"AACACCAC"},"345":{i7:"GAGATGTC",i5:"TAGTCAGC"},"346":{i7:"TACGGTTG",i5:"AGTTCGCA"},"347":{i7:"CTATCGCA",i5:"CGCGTATT"},"348":{i7:"TCGAACCA",i5:"AACCGTGT"},"349":{i7:"GAACGCTT",i5:"AAGTGCAG"},"350":{i7:"CAGAATCG",i5:"CCAGTTGA"},
  "351":{i7:"ATGGTTGC",i5:"AGCCAACT"},"352":{i7:"GCTGGATT",i5:"CTAACCTG"},"353":{i7:"GATGCACT",i5:"ACTGGTGT"},"354":{i7:"ACCAATGC",i5:"GTGATCCA"},"355":{i7:"GTCCTAAG",i5:"CGAAGTCA"},"356":{i7:"CCGACTAT",i5:"TCAGACAC"},"357":{i7:"TTGGTCTC",i5:"CCGTAACT"},"358":{i7:"GCCTTGTT",i5:"AGCGAGAT"},"359":{i7:"GATACTGG",i5:"GAACCTTC"},"360":{i7:"ATTCGAGG",i5:"ACAAGCTC"},
  "361":{i7:"GTCAGTTG",i5:"CGATTGGA"},"362":{i7:"GTAGAGCA",i5:"TATGACCG"},"363":{i7:"ACGTGATG",i5:"GATAGCCA"},"364":{i7:"TAAGTGGC",i5:"ATCCGTTG"},"365":{i7:"TGTGAAGC",i5:"TCTAGGAG"},"366":{i7:"CATTCGGT",i5:"AATTCCGG"},"367":{i7:"TTGGTGAG",i5:"CACGTCTA"},"368":{i7:"CAGTTCTG",i5:"GTCAGTCA"},"369":{i7:"AGGCTTCT",i5:"GAGCTCTA"},"370":{i7:"GAATCGTG",i5:"TTCACGGA"},
  "371":{i7:"ACCAGCTT",i5:"GTATCGAG"},"372":{i7:"CTCATTGC",i5:"CAGGTAAG"},"373":{i7:"CGATAGAG",i5:"TTCGCCAT"},"374":{i7:"TGGAGAGT",i5:"AGGTAGGA"},"375":{i7:"GTATGCTG",i5:"AACTGAGG"},"376":{i7:"CTGGAGTA",i5:"CCAAGTAG"},"377":{i7:"AATGCCTC",i5:"TGCTGTGA"},"378":{i7:"TGAGGTGT",i5:"ACAACGTG"},"379":{i7:"ACATTGCG",i5:"CTCGACTT"},"380":{i7:"TCTCTAGG",i5:"ACGGTACA"},
  "381":{i7:"CGCTAGTA",i5:"CTGATGAG"},"382":{i7:"AATGGACG",i5:"GTGAGACT"},"383":{i7:"GATAGCGA",i5:"CATCCAAG"},"384":{i7:"CGACCATT",i5:"TGATAGGC"}
};

const EQUIPMENT_OPTIONS = [
  {value:"ILLUMINA_500",label:"illumina500"},{value:"ILLUMINA_550DX",label:"illumina550dx"},
  {value:"SALUS_PRO",label:"Salus Pro"},{value:"SIKUN_2000",label:"Sikun2000"},{value:"MGI_G99",label:"MGI G99"},
];
const CHIP_OPTIONS:Record<string,{value:string;label:string}[]> = {
  ILLUMINA_500:[{value:"S1",label:"S1 Flow Cell"},{value:"S2",label:"S2 Flow Cell"},{value:"S4",label:"S4 Flow Cell"}],
  ILLUMINA_550DX:[{value:"S1",label:"S1 Flow Cell"},{value:"S2",label:"S2 Flow Cell"}],
  SALUS_PRO:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}],
  SIKUN_2000:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}],
  MGI_G99:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}],
};
const READ_TYPE_OPTIONS = [{value:"SE75",label:"SE75"},{value:"SE100",label:"SE100"},{value:"PE150",label:"PE150"}];
const STEPS = [
  {key:"clean_equip",label:"设备准备"},{key:"reagent_prep",label:"试剂准备"},
  {key:"sample_prep",label:"样本准备"},{key:"on_machine",label:"上机测序"},{key:"cleanup",label:"清洁台面"},
];

interface MixItem { id:string; pooling_batch_id:string; pooling_batch_number:string; mix_name:string; female:number; male:number; data_amount:number; }
interface MixRow { mix_name:string; source:string; library_conc:number|null; input_amount:number; input_vol:number; expected_conc:number; water_added:number; }
interface SampleItem { id:string; patient_name:string; category:string; test_sample_id:string|null; }
interface BatchItem { id:string; batch_number:string; status:string; status_display:string; sample_count:number; female_count:number; male_blood_count:number; male_other_count:number; }
interface BatchDetail extends BatchItem { female_samples:SampleItem[]; male_blood_samples:SampleItem[]; male_other_samples:SampleItem[]; hyb_seq_data:any; }

export default function NipptHybSeq() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail|null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingMixes, setPendingMixes] = useState<MixItem[]>([]);
  const [selectedMixIds, setSelectedMixIds] = useState<Set<string>>(new Set());
  const [chipNumber, setChipNumber] = useState("");
  const [batchNumberPreview, setBatchNumberPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // Sequencing state
  const [platform, setPlatform] = useState("");
  const [stepConfirmations, setStepConfirmations] = useState<Record<string,boolean>>({});
  const [mixRows, setMixRows] = useState<MixRow[]>([]);
  const [finalConc, setFinalConc] = useState(0.783);

  const fetchBatches = useCallback(async()=>{setLoading(true);try{const r=await(casesApi as any).listHybSeqBatches();setBatches(r.data?.results||[])}catch{}finally{setLoading(false)}},[]);
  useEffect(()=>{fetchBatches()},[fetchBatches]);

  const fetchDetail = async(id:string)=>{
    setBatchLoading(true);
    try{
      const r=await(casesApi as any).getHybSeqBatch(id);
      const d=r.data; setSelectedBatch(d);
      const sd=d.hyb_seq_data||{};
      setPlatform(sd.platform||""); setStepConfirmations(sd.step_confirmations||{});
      // Auto-init mix rows from saved or from mix_ids
      let rows = sd.mix_rows||[];
      if (rows.length===0 && sd.mix_ids && sd.mix_ids.length>0) {
        const mixSrc = d.mix_sources || sd.mix_sources || [];
        const chip = sd.chip_number || "";
        rows = sd.mix_ids.map((_:string,i:number)=>{
          return {mix_name:chip?`${chip}Mix${i+1}`:`mix${i+1}`,source:mixSrc[i]||"",library_conc:null,input_amount:10,input_vol:0,expected_conc:0.8,water_added:0};
        });
      }
      setMixRows(rows); setFinalConc(sd.final_conc??0.783);
      form.setFieldsValue({
        seq_date:sd.seq_date?dayjs(sd.seq_date):dayjs(), seq_time:sd.seq_time?dayjs(sd.seq_time,"HH:mm"):dayjs(),
        equipment:sd.equipment||"", chip:sd.chip||"", read_type:sd.read_type||"",
        chip_number:sd.chip_number||"",
      });
    }catch{message.error("加载失败")}finally{setBatchLoading(false)}
  };

  const openNewBatch = async()=>{
    try{
      const r=await(casesApi as any).pendingHybSeqMixes();
      setPendingMixes(r.data?.mixes||[]); setSelectedMixIds(new Set()); setChipNumber("");
      const now=new Date();
      setBatchNumberPreview(`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-SEQ-???`);
      setModalOpen(true);
    }catch{message.error("加载失败")}
  };

  const createBatch = async()=>{
    if(selectedMixIds.size===0){message.warning("请选择mix");return}
    try{
      const mixIds = Array.from(selectedMixIds);
      const sources = mixIds.map(mid=>{
        const pm = pendingMixes.find((m:MixItem)=>m.id===mid);
        return pm?.mix_name || "";
      });
      const r=await(casesApi as any).createHybSeqBatch({mix_ids:mixIds, mix_sources:sources, chip_number:chipNumber});
      message.success(`批次 ${r.data.batch_number} 已创建`); setModalOpen(false); fetchBatches();
    }catch(e:any){message.error(e?.response?.data?.detail||"创建失败")}
  };

  // Mix table computations
  const mixSums = useMemo(()=>{
    const totalInput = mixRows.reduce((s,r)=>s+(r.input_amount??0),0);
    const totalVol = mixRows.reduce((s,r)=>s+(r.input_vol??0),0);
    const theoryConc = totalVol>0?totalInput/totalVol:0;
    const water = (theoryConc/finalConc-1)*totalVol;
    return {totalInput, totalVol, theoryConc:Math.round(theoryConc*100)/100, water:Math.round(water*100)/100};
  },[mixRows, finalConc]);

  const updateMixCell = (i:number, field:string, val:any)=>{
    setMixRows(prev=>{
      const next=[...prev]; const r={...next[i]};
      (r as any)[field]=val;
      if(field==="library_conc") r.input_vol=(r.input_amount??0)/(val||1);
      if(field==="input_amount") r.input_vol=val/(r.library_conc||1);
      next[i]=r; return next;
    });
  };

  const save = async()=>{
    if(!selectedBatch)return; setSaving(true);
    try{
      const sd = {
        platform, step_confirmations:stepConfirmations,
        ...form.getFieldsValue(), mix_rows:mixRows, final_conc:finalConc,
      };
      await(casesApi as any).saveHybSeq(selectedBatch.id,{hyb_seq_data:sd});
      message.success("保存成功"); fetchDetail(selectedBatch.id);
    }catch{message.error("保存失败")}finally{setSaving(false)}
  };

  const completeBatch = async()=>{if(!selectedBatch)return;try{await(casesApi as any).completeHybSeq(selectedBatch.id);message.success("已完成");setSelectedBatch(null);fetchBatches()}catch{message.error("失败")}};
  const deleteBatch = async(id:string)=>{try{await(casesApi as any).deleteHybSeqBatch(id);message.success("已删除");setSelectedBatch(null);fetchBatches()}catch(e:any){message.error(e?.response?.data?.detail||"删除失败")}};

  const batchColumns=[
    {title:"批次号",dataIndex:"batch_number",width:140,render:(v:string)=><Text code style={{fontSize:12}}>{v}</Text>},
    {title:"状态",dataIndex:"status",width:60,render:(v:string)=>{const c:Record<string,string>={DRAFT:"default",IN_PROGRESS:"blue",COMPLETED:"green"},l:Record<string,string>={DRAFT:"待处理",IN_PROGRESS:"处理中",COMPLETED:"已完成"};return<Tag color={c[v]||"default"}>{l[v]||v}</Tag>}},
    {title:"样本",width:100,render:(_:any,r:BatchItem)=><Text style={{fontSize:11}}>👩{r.female_count} 👨{r.male_blood_count+r.male_other_count}</Text>},
  ];

  const th:React.CSSProperties={border:"1px solid #bbb",padding:"4px 8px",textAlign:"center",fontWeight:700,background:"#d5e8d4",fontSize:12};
  const td:React.CSSProperties={border:"1px solid #d9d9d9",padding:"4px 6px",textAlign:"center",fontSize:12};

  return (
    <div style={{display:"flex",height:"calc(100vh - 140px)",gap:12}}>
      <Card size="small" style={{width:sidebarCollapsed?50:380,flexShrink:0,transition:"width 0.25s",overflow:"hidden"}}
        title={sidebarCollapsed?undefined:"杂交及测序"}
        extra={<Button type="text" size="small" icon={sidebarCollapsed?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>} onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}/>}>
        {!sidebarCollapsed&&(<>
          <Button type="primary" icon={<PlusOutlined/>} block onClick={openNewBatch} style={{marginBottom:8}}>新建上机批次</Button>
          <Table dataSource={batches} rowKey="id" loading={loading} size="small" pagination={false} scroll={{y:"calc(100vh - 280px)"}}
            onRow={(r:BatchItem)=>({onClick:()=>fetchDetail(r.id),style:{background:selectedBatch?.id===r.id?"#e6f4ff":undefined,cursor:"pointer"}})} columns={batchColumns}/>
        </>)}
      </Card>
      <div style={{flex:1,overflow:"auto"}}>
        {selectedBatch?(
          <Card size="small" title={<Space><Text strong>{selectedBatch.batch_number}</Text><Tag color={selectedBatch.status==="COMPLETED"?"green":selectedBatch.status==="IN_PROGRESS"?"blue":"default"}>{selectedBatch.status_display}</Tag></Space>}
            extra={<Space>
              {selectedBatch.status!=="COMPLETED"&&<Popconfirm title="删除？" onConfirm={()=>deleteBatch(selectedBatch.id)}><Button size="small" danger icon={<DeleteOutlined/>}>删除</Button></Popconfirm>}
              <Button icon={<ReloadOutlined/>} size="small" loading={batchLoading} onClick={()=>fetchDetail(selectedBatch.id)}>刷新</Button>
              {selectedBatch.status!=="COMPLETED"&&<>
                <Button type="primary" icon={<CheckOutlined/>} size="small" loading={saving} onClick={save}>保存</Button>
                <Popconfirm title="完成批次？" onConfirm={completeBatch}><Button type="primary" size="small" danger>完成</Button></Popconfirm>
              </>}
            </Space>}>
            {/* Mix dilution table — ON TOP */}
            {(
              <Card size="small" title="🧪 Mix 稀释表" style={{marginBottom:12}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,tableLayout:"fixed"}}>
                    <thead><tr>
                      <th style={{...th,width:80}}>mix编号</th>
                      <th style={{...th,width:150}}>mix来源</th>
                      <th style={{...th,width:90}}>文库浓度</th>
                      <th style={{...th,width:65}}>投入量</th>
                      <th style={{...th,width:75}}>投入体积</th>
                      <th style={{...th,width:85}}>理论浓度</th>
                      <th style={{...th,width:65}}>预期浓度</th>
                      <th style={{...th,width:75}}>加水量</th>
                    </tr></thead>
                    <tbody>
                      {mixRows.map((r,i)=>(
                        <tr key={i} style={{background:"#e8f5e9"}}>
                          <td style={td}><Tag color="blue">{r.mix_name}</Tag></td>
                          <td style={td}><Input size="small" value={r.source} onChange={e=>updateMixCell(i,"source",e.target.value)} style={{width:140}} placeholder="例:20260723-03-001-mix1"/></td>
                          <td style={td}><InputNumber size="small" min={0} step={0.001} value={r.library_conc} onChange={v=>updateMixCell(i,"library_conc",v)} style={{width:80}} placeholder="0"/></td>
                          <td style={td}><InputNumber size="small" min={0} step={0.1} value={r.input_amount} onChange={v=>updateMixCell(i,"input_amount",v)} style={{width:60}}/></td>
                          <td style={{...td,fontFamily:"monospace"}}>{r.input_vol>0?r.input_vol.toFixed(2):"-"}</td>
                          {i===0?<td style={{...td,background:"#e6f7ff",fontWeight:700}} rowSpan={mixRows.length}>{mixSums.theoryConc.toFixed(2)}</td>:null}
                          <td style={td}><InputNumber size="small" min={0} step={0.1} value={r.expected_conc} onChange={v=>updateMixCell(i,"expected_conc",v)} style={{width:60}}/></td>
                          <td style={{...td,fontFamily:"monospace"}}>{mixSums.water>0?mixSums.water.toFixed(2):"-"}</td>
                        </tr>
                      ))}
                      <tr style={{background:"#f5f5f5"}}>
                        <td style={td} colSpan={8}>
                          <Button size="small" type="dashed" onClick={()=>{
                            setMixRows(prev=>[...prev,{mix_name:`mix${prev.length+1}`,source:"",library_conc:null,input_amount:10,input_vol:0,expected_conc:0.8,water_added:0}]);
                          }} style={{width:"100%"}}>＋ 新增行</Button>
                        </td>
                      </tr>
                      <tr style={{background:"#fffbe6",fontWeight:600}}>
                        <td style={td} colSpan={6}>最终检测浓度: <InputNumber size="small" min={0} step={0.001} value={finalConc} onChange={v=>v!==null&&setFinalConc(v)} style={{width:80}}/></td>
                        <td style={td} colSpan={2}>总投入: {mixSums.totalInput.toFixed(2)} ng | 总体积: {mixSums.totalVol.toFixed(2)} μL</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Platform + Basic Info */}
            <Card size="small" style={{marginBottom:12}}>
              <Space direction="vertical" style={{width:"100%"}}>
                <Space wrap>
                  <Text strong>测序平台:</Text>
                  <Select style={{width:180}} value={platform||undefined} onChange={setPlatform} options={EQUIPMENT_OPTIONS} placeholder="选择平台"/>
                  {platform&&<>
                    <Text>芯片:</Text>
                    <Select style={{width:150}} options={CHIP_OPTIONS[platform]||[]} value={form.getFieldValue("chip")} onChange={v=>form.setFieldsValue({chip:v})} placeholder="选择"/>
                  </>}
                  <Text>Read Type:</Text>
                  <Select style={{width:100}} options={READ_TYPE_OPTIONS} value={form.getFieldValue("read_type")} onChange={v=>form.setFieldsValue({read_type:v})} placeholder="选择"/>
                </Space>
                <Form form={form} layout="inline" style={{flexWrap:"wrap",gap:8}}>
                  <Form.Item name="seq_date" label="日期"><DatePicker size="small" style={{width:120}}/></Form.Item>
                  <Form.Item name="seq_time" label="时间"><TimePicker size="small" format="HH:mm" style={{width:90}}/></Form.Item>
                  <Form.Item name="equipment" label="设备"><Select size="small" style={{width:160}} options={EQUIPMENT_OPTIONS} placeholder="选择"/></Form.Item>
                  <Form.Item name="chip_number" label="Chip号"><Input size="small" style={{width:120}} placeholder="chip编号"/></Form.Item>
                </Form>
              </Space>
            </Card>

            {/* Step confirmations */}
            <Card size="small" style={{marginBottom:12}}>
              <Text strong style={{marginBottom:8,display:"block"}}>📋 步骤确认</Text>
              <Space wrap>{STEPS.map(s=><Checkbox key={s.key} checked={!!stepConfirmations[s.key]} onChange={e=>setStepConfirmations(p=>({...p,[s.key]:e.target.checked}))}>{s.label}</Checkbox>)}</Space>
            </Card>

            {/* Index table — NIPT-style */}
            {selectedBatch.female_samples&&selectedBatch.female_samples.length>0&&(
              <Card size="small" title={`📊 Index列表 — ${selectedBatch.sample_count} 样本`} style={{marginBottom:12}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,tableLayout:"fixed"}}>
                    <thead><tr>
                      <th style={{...th,width:36}}>#</th>
                      <th style={{...th,width:90}}>PT编号</th>
                      <th style={{...th,width:55}}>Index</th>
                      <th style={{...th,width:80}}>I7</th>
                      <th style={{...th,width:80}}>I5</th>
                      <th style={{...th,width:140}}>批次号</th>
                      <th style={{...th,width:140}}>上传ID</th>
                    </tr></thead>
                    <tbody>
                      {[...(selectedBatch.female_samples||[]),...(selectedBatch.male_blood_samples||[]),...(selectedBatch.male_other_samples||[])].map((s:any,i:number)=>{
                        const idxVal = s.index||String(i+1);
                        const idxNum = parseInt(idxVal)||0;
                        const padded = String(idxNum||"").padStart(3,"0");
                        const seq = INDEX_LOOKUP[padded] || {i7:"",i5:""};
                        const chip = selectedBatch.hyb_seq_data?.chip_number || selectedBatch.batch_number;
                        const ptId = s.test_sample_id||"-";
                        const uploadId = chip+"_"+padded+"_"+ptId;
                        return (
                          <tr key={i} style={{background:i%2===0?"#e8f5e9":"#fafafa"}}>
                            <td style={td}>{i+1}</td>
                            <td style={td}><Text code style={{fontSize:11}}>{ptId}</Text></td>
                            <td style={td}>{idxVal}</td>
                            <td style={td}>{seq.i7}</td>
                            <td style={td}>{seq.i5}</td>
                            <td style={td}>{chip}</td>
                            <td style={td}><Text style={{fontSize:11}}>{uploadId}</Text></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </Card>
        ):(
          <div style={{textAlign:"center",paddingTop:100,color:"#999"}}><Title level={5} type="secondary">选择批次查看详情</Title><Button type="primary" icon={<PlusOutlined/>} onClick={openNewBatch}>新建上机批次</Button></div>
        )}
      </div>
      <Modal title="新建杂交测序批次" open={modalOpen} onOk={createBatch} onCancel={()=>setModalOpen(false)} width={650} okText={`创建批次 (${selectedMixIds.size}个mix)`}>
        <div style={{marginBottom:12,padding:"8px 12px",background:"#f6ffed",borderRadius:6}}>
          <Text strong>批次号：</Text><Text code style={{fontSize:16}}>{batchNumberPreview}</Text>
        </div>
        <div style={{marginBottom:8}}>
          <Text>Chip号：</Text>
          <Input size="small" style={{width:150}} value={chipNumber} onChange={e=>{setChipNumber(e.target.value);const n=new Date();setBatchNumberPreview(`${n.getFullYear()}${String(n.getMonth()+1).padStart(2,"0")}${String(n.getDate()).padStart(2,"0")}-SEQ-${e.target.value||"???"}`)}} placeholder="输入chip号"/>
        </div>
        <div style={{maxHeight:350,overflow:"auto"}}>
          {pendingMixes.map(m=>{
            const checked = selectedMixIds.has(m.id);
            return (
              <div key={m.id} style={{padding:"4px 8px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:8}}>
                <Checkbox checked={checked} onChange={()=>{setSelectedMixIds(p=>{const n=new Set(p);checked?n.delete(m.id):n.add(m.id);return n})}}/>
                <Tag color="blue">{m.mix_name}</Tag>
                <Text type="secondary">女:{m.female} 男:{m.male} 数据量:{m.data_amount}</Text>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
