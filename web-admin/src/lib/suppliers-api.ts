import{api}from'./auth-api';
export type Supplier={id:string;code:string;name:string;contactName:string;phone:string;email:string;address:string;currentDebt:number;active:boolean;createdAt:string;updatedAt:string};
export type SupplierInput={name:string;contactName:string;phone:string;email:string;address:string;currentDebt:number};
export type SupplierList={items:Supplier[];pagination:{page:number;pageSize:number;total:number;totalPages:number};summary:{total:number;active:number;inactive:number;currentDebt:number}};
export function getSuppliers(filters:{q?:string;active?:'true'|'false'|'all';page?:number}){const p=new URLSearchParams({active:filters.active??'all',page:String(filters.page??1),pageSize:'20'});if(filters.q)p.set('q',filters.q);return api<SupplierList>(`suppliers?${p}`);}
export const getSupplier=(id:string)=>api<Supplier>(`suppliers/${id}`);export const createSupplier=(data:SupplierInput&{code:string})=>api<Supplier>('suppliers','POST',data);export const updateSupplier=(id:string,data:SupplierInput)=>api<Supplier>(`suppliers/${id}`,'PUT',data);export const setSupplierStatus=(id:string,active:boolean)=>api<Supplier>(`suppliers/${id}/status`,'PATCH',{active});
