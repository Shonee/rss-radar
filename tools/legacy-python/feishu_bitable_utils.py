#!/usr/bin/env python3
# [归档参考实现] 原 rss_private 项目脚本，原样复制于此作历史参考；不参与 CI/构建，不保证可运行。
# 脱敏：原文件硬编码的飞书 app_id/app_secret 已改为从环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET 读取；勿将凭证写回代码。
# -*- coding: utf-8 -*-
"""
飞书多维表格工具类
支持增删改查、条件查询、批量操作等功能

使用前需要先获取飞书应用的 app_id 和 app_secret
并确保应用具有多维表格的相关权限

官方 API 文档：https://open.feishu.cn/api-explorer/<APP_ID>?apiName=search&from=op_doc_tab&project=bitable&resource=app.table.record&version=v1
飞书API： [概述 - 飞书 API](https://s.apifox.cn/apidoc/docs-site/532425/doc-436424) 

 [dungeer619/feishu-bitable-python-tool: 通过Python与飞书多维表格实现读写等交互. Using Python to interact with Feishu Bitable](https://github.com/dungeer619/feishu-bitable-python-tool) 
"""

import os
import requests
import json
import time
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass
from enum import Enum


class FilterOperator(Enum):
    """过滤条件操作符"""
    EQUAL = "="
    NOT_EQUAL = "!="
    GREATER_THAN = ">"
    GREATER_EQUAL = ">="
    LESS_THAN = "<"
    LESS_EQUAL = "<="
    CONTAINS = "contains"
    NOT_CONTAINS = "not_contains"
    STARTS_WITH = "starts_with"
    ENDS_WITH = "ends_with"
    IS_EMPTY = "is_empty"
    IS_NOT_EMPTY = "is_not_empty"


@dataclass
class FilterCondition:
    """过滤条件"""
    field_name: str
    operator: FilterOperator
    value: Any = None


@dataclass
class SortCondition:
    """排序条件"""
    field_name: str
    desc: bool = False


class FeishuBitableError(Exception):
    """飞书多维表格异常"""
    pass


class FeishuBitableUtils:
    """飞书多维表格工具类"""
    
    def __init__(self, app_id: str, app_secret: str):
        """
        初始化
        
        Args:
            app_id: 飞书应用ID
            app_secret: 飞书应用密钥
        """
        self.app_id = app_id
        self.app_secret = app_secret
        self.access_token = None
        self.token_expire_time = 0
        self.base_url = "https://open.feishu.cn/open-apis"
        
    def _get_access_token(self) -> str:
        """获取访问令牌"""
        current_time = time.time()
        
        # 如果token未过期，直接返回
        if self.access_token and current_time < self.token_expire_time:
            return self.access_token
            
        # 获取新的access_token
        url = f"{self.base_url}/auth/v3/tenant_access_token/internal"
        payload = {
            "app_id": self.app_id,
            "app_secret": self.app_secret
        }
        
        response = requests.post(url, json=payload)
        result = response.json()
        
        if result.get("code") != 0:
            raise FeishuBitableError(f"获取access_token失败: {result.get('msg')}")
            
        self.access_token = result["tenant_access_token"]
        # 提前5分钟过期
        self.token_expire_time = current_time + result["expire"] - 300
        
        return self.access_token
    
    def get_app_token(self, bitable_url: str):
        app_token = bitable_url.split("?")[0].split("/")[-1]
        table_id = bitable_url.split("table=")[-1]
        table_id = table_id if '&' not in table_id else table_id.split('&')[0]
        return app_token, table_id
    
    def _make_request(self, method: str, url: str, **kwargs) -> Dict:
        """发起HTTP请求"""
        headers = {
            "Authorization": f"Bearer {self._get_access_token()}",
            "Content-Type": "application/json"
        }
        
        if "headers" in kwargs:
            headers.update(kwargs["headers"])
        kwargs["headers"] = headers
        
        # print("request params:", kwargs)
        response = requests.request(method, url, **kwargs)
        result = response.json()
        # print("response json:", result)
        
        if result.get("code") != 0:
            raise FeishuBitableError(f"API请求失败: {result.get('msg')}")
            
        return result

    def get_table_base_info(self, app_token: str):
        '''
        获取多维表格元数据

        Args:
            app_token: 多维表格的唯一标识符
        
        Returns:
            包含数据表元数据的字典
        '''
        url = f'{self.base_url}/bitable/v1/apps/{app_token}'
        return self._make_request("GET", url, params={})

    ################## record options
    
    def get_record(self, app_token: str, table_id: str, record_id: str) -> Dict:
        """
        获取单条记录
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            record_id: 记录的唯一标识符
            
        Returns:
            记录详情
        """
        url = f"{self.base_url}/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
        return self._make_request("GET", url)

    def get_records(self, app_token: str, table_id: str, 
                   view_id: str = None, filter_conditions: List[FilterCondition] = None,
                   sort_conditions: List[SortCondition] = None,
                   field_names: List[str] = None, page_size: int = 20, 
                   page_token: str = None) -> Dict:
        """
        获取数据表中的记录
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            view_id: 视图的唯一标识符
            filter_conditions: 过滤条件列表
            sort_conditions: 排序条件列表
            field_names: 指定返回的字段名列表
            page_size: 分页大小
            page_token: 分页标记
            
        Returns:
            包含记录列表的字典
        """
        url = f"{self.base_url}/bitable/v1/apps/{app_token}/tables/{table_id}/records"
        params = {"page_size": page_size}
        
        if view_id:
            params["view_id"] = view_id
        if page_token:
            params["page_token"] = page_token
        if field_names:
            params["field_names"] = json.dumps(field_names)
            
        # 构建过滤条件
        if filter_conditions:
            filter_dict = self._build_filter(filter_conditions)
            params["filter"] = str(filter_dict)
            
        # 构建排序条件
        if sort_conditions:
            sort_list = []
            # for sort_cond in sort_conditions:
            #     sort_list.append({
            #         "field_name": sort_cond.field_name,
            #         "desc": sort_cond.desc
            #     })
            for sort_cond in sort_conditions:
                sort_list.append(
                    sort_cond.field_name + ' ' + "desc" if sort_cond.desc else 'asc'
                )
            params["sort"] = json.dumps(sort_list)
            # print(params)
            
        return self._make_request("GET", url, params=params)
    
    def create_record(self, app_token: str, table_id: str, fields: Dict[str, Any]) -> Dict:
        """
        新增记录
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            fields: 记录字段数据
            
        Returns:
            新增记录的结果
        """
        url = f"{self.base_url}/bitable/v1/apps/{app_token}/tables/{table_id}/records"
        payload = {"fields": fields}
        
        return self._make_request("POST", url, json=payload)
    
    def batch_create_records(self, app_token: str, table_id: str, 
                           records: List[Dict[str, Any]]) -> Dict:
        """
        批量新增记录
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            records: 记录列表，每个记录包含fields字段
            
        Returns:
            批量新增的结果
        """
        url = f"{self.base_url}/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create"
        
        # 构建请求数据
        records_data = []
        for record in records:
            records_data.append({"fields": record})
            
        payload = {"records": records_data}
        
        return self._make_request("POST", url, json=payload)
    
    def update_record(self, app_token: str, table_id: str, record_id: str, 
                     fields: Dict[str, Any]) -> Dict:
        """
        更新记录
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            record_id: 记录的唯一标识符
            fields: 要更新的字段数据
            
        Returns:
            更新结果
        """
        url = f"{self.base_url}/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
        payload = {"fields": fields}
        
        return self._make_request("PUT", url, json=payload)
    
    def batch_update_records(self, app_token: str, table_id: str, 
                           records: List[Dict[str, Any]]) -> Dict:
        """
        批量更新记录
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            records: 记录列表，每个记录包含record_id和fields
            
        Returns:
            批量更新的结果
        """
        url = f"{self.base_url}/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_update"
        
        # 构建请求数据
        records_data = []
        for record in records:
            records_data.append({
                "record_id": record["record_id"],
                "fields": record["fields"]
            })
            
        payload = {"records": records_data}
        
        return self._make_request("PUT", url, json=payload)
    
    def delete_record(self, app_token: str, table_id: str, record_id: str) -> Dict:
        """
        删除记录
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            record_id: 记录的唯一标识符
            
        Returns:
            删除结果
        """
        url = f"{self.base_url}/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
        
        return self._make_request("DELETE", url)
    
    def batch_delete_records(self, app_token: str, table_id: str, 
                           record_ids: List[str]) -> Dict:
        """
        批量删除记录
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            record_ids: 要删除的记录ID列表
            
        Returns:
            批量删除的结果
        """
        url = f"{self.base_url}/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_delete"
        payload = {"records": record_ids}
        
        return self._make_request("DELETE", url, json=payload)
    
    def search_records(self, app_token: str, table_id: str, 
                      filter_conditions: List[FilterCondition] = None,
                      sort_conditions: List[SortCondition] = None,
                      field_names: List[str] = None, 
                      needStruct = True) -> List[Dict]:
        """
        搜索记录（自动处理分页）
        
        Args:
            app_token: 多维表格的唯一标识符
            table_id: 数据表的唯一标识符
            filter_conditions: 过滤条件列表
            sort_conditions: 排序条件列表
            field_names: 指定返回的字段名列表
            needStruct: 是否需要结构化结果，默认需要结构化
            
        Returns:
            所有匹配的记录列表
        """
        all_records = []
        page_token = None
        
        while True:
            result = self.get_records(
                app_token=app_token,
                table_id=table_id,
                filter_conditions=filter_conditions,
                sort_conditions=sort_conditions,
                field_names=field_names,
                page_size=100,  # 使用最大页面大小
                page_token=page_token
            )
            
            if "data" in result and "items" in result["data"]:
                all_records.extend(result["data"]["items"])
            
            # 检查是否还有下一页
            if not result.get("data", {}).get("has_more", False):
                break
                
            page_token = result["data"].get("page_token")
        
        if needStruct:
            all_records = self.records_struct(all_records)
        return all_records
    
    def _build_filter(self, filter_conditions: List[FilterCondition]) -> Dict:
        """构建过滤条件对象"""
        if not filter_conditions:
            return None
        
        conjunction = 'and'
        conditions = []
        filter_dict ={"conjunction":conjunction, "conditions": conditions}

        for condition in filter_conditions:
            if condition.operator in [FilterOperator.IS_EMPTY, FilterOperator.IS_NOT_EMPTY]:
                # 空值检查不需要value
                conditions.append({
                    "field_name": condition.field_name,
                    "operator": condition.operator.value
                })
            else:
                # 其他操作需要value
                if isinstance(condition.value, str):
                    value = f'"{condition.value}"'
                else:
                    value = str(condition.value)
                
                conditions.append({
                    "field_name": condition.field_name,
                    "operator": condition.operator.value,
                    "value": [value]
                })
        
        return filter_dict
    
    def records_struct(self, records):
        if not records:
            return None
        
        result = []
        for record in records:
            fields = record.get('fields')
            fields["record_id"] = record.get('record_id')
            result.append(fields)
        
        for record in result:
            for key, val in record.items():
                if isinstance(val, dict) and 'link' in val:
                    record[key] = val.get('link')

        # print("数据表记录结构化结果:", result) 
        return result


def bitable_get_info(bitable_url):
    import json
    # 初始化工具类
    bitable = FeishuBitableUtils(
        app_id=os.environ.get("FEISHU_APP_ID"),
        app_secret=os.environ.get("FEISHU_APP_SECRET")
    )    
    app_token,table_id = bitable.get_app_token(bitable_url)
    
    try:
        # 获取多维表格元数据信息
        info = bitable.get_table_base_info(app_token)
        print("元数据信息: ",info)
        
        # 条件查询
        filter_conditions = [
            # FilterCondition("年龄", FilterOperator.GREATER_THAN, 20),
            # FilterCondition("姓名", FilterOperator.CONTAINS, "张")
            # FilterCondition("url", FilterOperator.CONTAINS, "https")
        ]
        
        sort_conditions = [
            # SortCondition("年龄", desc=True)
            # SortCondition("createTime", desc=True)
        ]
        
        records = bitable.search_records(
            app_token=app_token,
            table_id=table_id,
            filter_conditions=filter_conditions,
            sort_conditions=sort_conditions
        )
        print("首个数据表记录数量:", len(records)) 
        print("首个数据表记录查询结果:", json.dumps(records, ensure_ascii=False)) 

        return records
    except FeishuBitableError as e:
        print(f"操作失败: {e}")


def bitable_add_records(bitable_url, records):
    '''
    bitable_url = ""
    fields={
            "姓名": "张三",
            "年龄": 25,
            "邮箱": "zhangsan@example.com"
        }
    '''

    # 初始化工具类
    bitable = FeishuBitableUtils(
        app_id=os.environ.get("FEISHU_APP_ID"),
        app_secret=os.environ.get("FEISHU_APP_SECRET")
    )    
    app_token,table_id = bitable.get_app_token(bitable_url)
    
    try:
        # 创建记录(单条)
        print("records:", records)
        new_record = bitable.create_record(
            app_token=app_token,
            table_id=table_id,
            fields=records
        )
        print("新增记录:", new_record)
        
        # 批量创建记录（批量）
        # batch_records = [
        #     {"姓名": "李四", "年龄": 30, "邮箱": "lisi@example.com"},
        #     {"姓名": "王五", "年龄": 28, "邮箱": "wangwu@example.com"}
        # ]
        if isinstance(records, dict):
            records = [records]
        print("batch records: ", records)
        
        # batch_result = bitable.batch_create_records(
        #     app_token=app_token,
        #     table_id=table_id,
        #     records=batch_records
        # )
        # print("批量创建结果:", batch_result)
    
    except FeishuBitableError as e:
        print(f"操作失败: {e}")


# 使用示例
if __name__ == "__main__":
    # 飞书多维表格
    '''
    RSS信息（数据库特殊token）：https://ginvh09pnwq.feishu.cn/wiki/WUQRwOplgi0jFZkmJN2cQclun5g?table=tbl5QgEv82j2XYIo&view=vewoYD3rcM
    RSS数据（空间通用token）：https://ginvh09pnwq.feishu.cn/base/IBNMbVJUuaKcgasQwMKc4eamnad?table=tblqLc4E03M5Uoh3&view=vewoYD3rcM
    '''
    # RSS 收集表
    bitable_url = 'https://ginvh09pnwq.feishu.cn/base/IBNMbVJUuaKcgasQwMKc4eamnad?table=tblqLc4E03M5Uoh3&view=vewoYD3rcM'
    
    bitable_get_info(bitable_url)

    # add_record = {"标题": "test", "RSS地址": "https://www.test.com"}
    # bitable_add_records(bitable_url, add_record)

    # add_records = [
    #     {"标题": "test", "RSS地址": "https://www.test.com"},
    #     {"标题": "test", "RSS地址": "https://www.test.com"}
    # ]
    # bitable_add_records(bitable_url, add_records)
