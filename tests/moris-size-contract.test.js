import {describe,it,expect} from 'vitest';
import * as client from '../src/moris/size-contract.js';
import * as server from '../functions/_lib/moris/v5/retrieval/sizeGate.js';

describe('Moris Size Contract V1.2 — cạnh dài 5%, cạnh ngắn hỗ trợ',()=>{
  it('normalizeSizePair tự hoán vị về L>=W; 1 cạnh = cạnh dài; từ chối dữ liệu sai',()=>{
    expect(client.normalizeSizePair(30,120)).toEqual({length_mm:120,width_mm:30});
    expect(client.normalizeSizePair('12,5','40')).toEqual({length_mm:40,width_mm:12.5});

    // S1.1: chỉ 1 cạnh -> cạnh dài, width null (không chặn lưu/lọc)
    expect(client.normalizeSizePair(80,null)).toEqual({length_mm:80,width_mm:null});
    expect(client.normalizeSizePair(null,80)).toEqual({length_mm:80,width_mm:null});
    expect(client.normalizeSizePair('80','')).toEqual({length_mm:80,width_mm:null});
    expect(client.normalizeSizePair(80,'abc')).toEqual({length_mm:80,width_mm:null});

    for(const [l,w] of [[0,10],[10,0],[-4,10],[5001,10],[NaN,NaN],[null,null],['',''],['abc','']]){
      expect(client.normalizeSizePair(l,w),`(${l},${w}) phải null`).toBeNull();
    }
  });

  it('shapeClass dùng ngưỡng 5% trên cạnh dài; thiếu cạnh ngắn -> null (không kết luận)',()=>{
    expect(client.shapeClass(100,100)).toBe('square');
    expect(client.shapeClass(100,95)).toBe('square');
    expect(client.shapeClass(100,94.9)).toBe('rect');
    expect(client.shapeClass(100,null)).toBeNull();
    expect(client.shapeClass(0,10)).toBeNull();
  });

  it('toleranceForEdge: 5% không sàn mm',()=>{
    expect(client.toleranceForEdge(100)).toBeCloseTo(5,6);
    expect(client.toleranceForEdge(30)).toBe(1.5);
    expect(client.toleranceForEdge(1000)).toBeCloseTo(50,6);
    expect(client.toleranceForEdge(0)).toBeNull();
    expect(client.toleranceForEdge(100,{relative:0.1,floorMm:0})).toBeCloseTo(10,6);
    expect(client.toleranceForEdge(100,client.SIZE_TOLERANCE_BY_SOURCE.manual)).toBeCloseTo(5,6);
    expect(client.toleranceForEdge(20,client.SIZE_TOLERANCE_BY_SOURCE.manual)).toBe(1);
  });

  it('resolveSizeTolerance: mọi nguồn đều 5%/0mm',()=>{
    expect(client.resolveSizeTolerance({source:'user'},{method:'user'})).toEqual({relative:0.05,floorMm:0});
    expect(client.resolveSizeTolerance({},{})).toEqual({relative:0.05,floorMm:0});
    expect(client.resolveSizeTolerance({source:'user'},{method:'caliper'})).toEqual({relative:0.05,floorMm:0});
    expect(client.resolveSizeTolerance({source:'camera_measured'},{method:'caliper'})).toEqual({relative:0.05,floorMm:0});
    expect(client.resolveSizeTolerance({source:'camera_measured'},{method:'erp'})).toEqual({relative:0.05,floorMm:0});
    expect(client.resolveSizeTolerance({source:'user'},{method:'user'},{relative:0.2,floorMm:1}))
      .toEqual({relative:0.2,floorMm:1});
  });

  it('evaluateSizeMatch: nhập tay 5% tính trên chiều dài query, không sàn',()=>{
    const q={length_mm:200,width_mm:100};
    expect(client.evaluateSizeMatch(q,{length_mm:190,width_mm:100}).status).toBe('match');
    expect(client.evaluateSizeMatch(q,{length_mm:180,width_mm:100}).status).toBe('mismatch');
    expect(client.evaluateSizeMatch(q,{length_mm:175,width_mm:100}).status).toBe('mismatch');

    const small={length_mm:20,width_mm:20};
    expect(client.evaluateSizeMatch(small,{length_mm:21,width_mm:20}).status).toBe('match');
    expect(client.evaluateSizeMatch(small,{length_mm:21.01,width_mm:20}).status).toBe('mismatch');

    // override tường minh (mức chặt verified) vẫn hoạt động
    expect(client.evaluateSizeMatch(small,{length_mm:23,width_mm:20},{relative:0.05,floorMm:2}).status).toBe('mismatch');
  });

  it('180 mm: nhận cả 171 và 189 mm, loại ngay ngoài hai biên; width chỉ là evidence',()=>{
    const query={length_mm:180,width_mm:40,source:'user'};
    expect(client.evaluateSizeMatch(query,{length_mm:171,width_mm:20}).status).toBe('match');
    expect(client.evaluateSizeMatch(query,{length_mm:189,width_mm:90}).status).toBe('match');
    expect(client.evaluateSizeMatch(query,{length_mm:170.99}).status).toBe('mismatch');
    expect(client.evaluateSizeMatch(query,{length_mm:189.01}).status).toBe('mismatch');
    const withWidth=client.evaluateSizeMatch(query,{length_mm:180,width_mm:20});
    expect(withWidth.status).toBe('match');
    expect(withWidth.edges.find(edge=>edge.key==='width_mm').ok).toBe(false);
  });

  it('evaluateSizeMatch: verified dùng cùng 5%/0mm',()=>{
    const q={length_mm:100,width_mm:60,source:'camera_measured'};
    const c={length_mm:102,width_mm:57,method:'caliper'};
    expect(client.evaluateSizeMatch(q,c).status).toBe('match');
    expect(client.evaluateSizeMatch(q,c).tolerance).toEqual({relative:0.05,floorMm:0});
    expect(client.evaluateSizeMatch(q,{length_mm:98.9,width_mm:55,method:'caliper'}).status).toBe('match');
  });

  it('evaluateSizeMatch: thiếu cạnh ngắn (1 bên) -> match_partial chỉ so cạnh dài',()=>{
    const partial=client.evaluateSizeMatch({length_mm:100,width_mm:null},{length_mm:102,width_mm:60});
    expect(partial.status).toBe('match_partial');
    expect(partial.edges.map(e=>e.key)).toEqual(['length_mm']);

    const candidatePartial=client.evaluateSizeMatch({length_mm:100,width_mm:60},{length_mm:102,width_mm:null,method:'user'});
    expect(candidatePartial.status).toBe('match_partial');

    const partialLong=client.evaluateSizeMatch({length_mm:100},{length_mm:95,width_mm:60});
    expect(partialLong.status).toBe('match_partial');
    const partialMismatch=client.evaluateSizeMatch({length_mm:100},{length_mm:80,width_mm:60});
    expect(partialMismatch.status).toBe('mismatch');
  });

  it('evaluateSizeMatch: candidate nhập ngược thứ tự vẫn khớp sau chuẩn hoá',()=>{
    const verdict=client.evaluateSizeMatch({length_mm:120,width_mm:30},{length_mm:30,width_mm:120});
    expect(verdict.status).toBe('match');
    expect(verdict.permutation).toBe('identity');
  });

  it('evaluateSizeMatch: trung tính (unknown) khi thiếu cạnh dài/không hợp lệ',()=>{
    const verdict=client.evaluateSizeMatch({length_mm:40,width_mm:20},null);
    expect(verdict.status).toBe('unknown');
    expect(verdict.d_max).toBeNull();
    expect(client.evaluateSizeMatch({},{length_mm:40,width_mm:20}).status).toBe('unknown');
  });

  it('d_max chỉ tính cạnh dài; cạnh ngắn lệch không veto',()=>{
    const verdict=client.evaluateSizeMatch({length_mm:100,width_mm:60},{length_mm:59,width_mm:63});
    expect(verdict.status).toBe('mismatch');
    expect(verdict.permutation).toBe('identity');
    expect(verdict.d_max).toBeCloseTo(37/100,6);
    expect(client.sizeDistance({length_mm:100,width_mm:60},{length_mm:59,width_mm:63})).toBeCloseTo(0.37,6);
    expect(client.evaluateSizeMatch({length_mm:100,width_mm:60},{length_mm:102,width_mm:30}).status).toBe('match');
    expect(client.sizeDistance({length_mm:100,width_mm:null},{length_mm:90,width_mm:60})).toBeCloseTo(0.1,6);
    expect(client.sizeDistance(null,{length_mm:1,width_mm:1})).toBeNull();
  });

  it('normalizeQuerySize chuẩn hoá payload, cho phép thiếu cạnh ngắn (S1.1)',()=>{
    expect(client.normalizeQuerySize({length_mm:20,width_mm:30,source:'user',confidence:0.6}))
      .toEqual({length_mm:30,width_mm:20,shape_class:'rect',source:'user',confidence:0.6});
    expect(client.normalizeQuerySize({length_mm:50}))
      .toEqual({length_mm:50,width_mm:null,shape_class:null,source:'unknown',confidence:null});
    expect(client.normalizeQuerySize({length_mm:20,width_mm:30,source:'USER!!',confidence:2}).source).toBe('unknown');
    expect(client.normalizeQuerySize({length_mm:20,width_mm:30,source:'user',confidence:2}).confidence).toBeNull();
    expect(client.normalizeQuerySize({width_mm:30})).toMatchObject({length_mm:30,width_mm:null});
    expect(client.normalizeQuerySize({length_mm:-1,width_mm:30})).toBeNull();
    expect(client.normalizeQuerySize({length_mm:0})).toBeNull();
    expect(client.normalizeQuerySize(null)).toBeNull();
  });

  it('formatSizePair hiển thị 1 chữ số thập phân; thiếu cạnh ngắn chỉ hiện cạnh dài',()=>{
    expect(client.formatSizePair({length_mm:12.34,width_mm:5})).toBe('12.3 × 5 mm');
    expect(client.formatSizePair({length_mm:100,width_mm:60})).toBe('100 × 60 mm');
    expect(client.formatSizePair({length_mm:80})).toBe('80 mm');
    expect(client.formatSizePair(null)).toBe('');
  });

  it('mirror parity: client src/moris/size-contract.js === server sizeGate.js (cùng kết quả)',()=>{
    const pairs=[[100,60],[30,30],[12.5,40],[104,55],[59,63],[1000,900],[2,2],[5000,1],[80,null],[null,80]];
    for(const [l,w] of pairs){
      basicParity('normalizeSizePair',[l,w]);
      basicParity('shapeClass',[l,w]);
      basicParity('formatSizePair',[[l,w]]);
    }
    basicParity('toleranceForEdge',[100]);
    const queries=[
      [{length_mm:100,width_mm:60},{length_mm:104,width_mm:55}],
      [{length_mm:30,width_mm:30},{length_mm:31.4,width_mm:31.4}],
      [{length_mm:100,width_mm:60},{length_mm:59,width_mm:63}],
      [{length_mm:100,width_mm:60},{length_mm:102,width_mm:null}],
      [{length_mm:100,width_mm:null},{length_mm:90,width_mm:60}],
      [{length_mm:100,width_mm:60,source:'camera_measured'},{length_mm:104,width_mm:55,method:'caliper'}],
      [{length_mm:120,width_mm:30},null]
    ];
    for(const [q,c] of queries){
      expect(client.evaluateSizeMatch(q,c)).toEqual(server.evaluateSizeMatch(q,c));
      expect(client.sizeDistance(q,c)).toEqual(server.sizeDistance(q,c));
    }
    for(const raw of [{length_mm:20,width_mm:30,source:'user',confidence:0.6},{lengthMm:50,widthMm:50},{length_mm:80},null]){
      expect(client.normalizeQuerySize(raw)).toEqual(server.normalizeQuerySize(raw));
    }

    function basicParity(fn,args){
      expect(client[fn](...args),`${fn}(${JSON.stringify(args)})`).toEqual(server[fn](...args));
    }
  });
});
