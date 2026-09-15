# [归档参考实现] 原 rss_private 项目脚本，原样复制于此作历史参考；不参与 CI/构建，不保证可运行。
import requests
import os
import json
from feishu_bitable_utils import bitable_get_info
from file_utils import saveJson,saveCsv,saveText
from csv_pandas_utils import CsvPandasUtils

def get_rss_feed_form_feishu_bitable():
    bitable_url = 'https://ginvh09pnwq.feishu.cn/base/IBNMbVJUuaKcgasQwMKc4eamnad?table=tblqLc4E03M5Uoh3&view=vewoYD3rcM'
    return bitable_get_info(bitable_url)

def sync(rss_list:list):
    json_file_path = 'data/rss.json'
    old_data_list = json.load(open(json_file_path)) if os.path.exists(json_file_path) else []
    new_data_list = rss_list

    old_rss_url = {item['RSS地址'] for item in old_data_list}
    add_data_list = [item for item in new_data_list if item['RSS地址'] not in old_rss_url]
    
    if add_data_list:
        old_data_list.extend(add_data_list)
        json_data = json.dumps(old_data_list, ensure_ascii=False, indent=4, sort_keys=True)
        print(json_data)
        
        # saveCsv(json_data, 'data/rss.csv')

        csv_pandas_util = CsvPandasUtils()
        csv_pandas_util.save(csv_pandas_util.read_from_json_str(json_data), 'data/rss.csv')
        

        # saveJson(json_data, json_file_path)
        # md = '# RSS地址列表 \n'
        # for index, item in enumerate(old_data_list, start=1):
        #     md += f"{index}. {item.get('标题')}: {item.get('RSS地址')} \n"
        # print(md)
        # saveText(md, 'data/rss.md')

if __name__ == '__main__':
    result = get_rss_feed_form_feishu_bitable()
    sync(result)

    
