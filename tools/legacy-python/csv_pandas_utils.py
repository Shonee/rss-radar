# [归档参考实现] 原 rss_private 项目脚本，原样复制于此作历史参考；不参与 CI/构建，不保证可运行。
# -*- coding: utf-8 -*-
"""
CSV Pandas 工具类
提供基于 pandas 的 CSV 文件读写、过滤、转换、统计等常用操作。
"""

import os
import json
import logging
from io import StringIO
from typing import Any, Dict, List, Optional, Union

import pandas as pd

# 日志配置
logging.basicConfig(format='%(asctime)s %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class CsvPandasUtils:
    """基于 pandas 的 CSV 文件工具类"""

    # ------------------------------------------------------------------ #
    #  一、读取                                                             #
    # ------------------------------------------------------------------ #

    @staticmethod
    def read(file_path: str,
             encoding: str = 'utf-8',
             sep: str = ',',
             usecols: Optional[List[str]] = None,
             dtype: Optional[Dict[str, Any]] = None,
             nrows: Optional[int] = None) -> pd.DataFrame:
        """
        读取 CSV 文件，返回 DataFrame。

        :param file_path: CSV 文件路径
        :param encoding:  文件编码，默认 utf-8
        :param sep:       分隔符，默认逗号
        :param usecols:   只读取指定列，None 表示全部列
        :param dtype:     列类型映射，如 {'age': int}
        :param nrows:     只读取前 N 行，None 表示全部
        :return: DataFrame
        """
        logger.debug("读取 CSV: %s", file_path)
        return pd.read_csv(file_path, encoding=encoding, sep=sep,
                           usecols=usecols, dtype=dtype, nrows=nrows)

    @staticmethod
    def read_from_json_str(json_str: str) -> pd.DataFrame:
        """
        将 JSON 字符串（列表格式）转换为 DataFrame。

        :param json_str: JSON 字符串，如 '[{"name":"张三","age":18}]'
        :return: DataFrame
        """
        return pd.read_json(StringIO(json_str))

    # ------------------------------------------------------------------ #
    #  二、写入 / 保存                                                      #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _ensure_dir(file_path: str):
        dirname = os.path.dirname(file_path)
        if dirname and not os.path.exists(dirname):
            os.makedirs(dirname)

    @classmethod
    def save(cls, df: pd.DataFrame,
             file_path: str,
             encoding: str = 'utf-8-sig',
             index: bool = False,
             sep: str = ',') -> str:
        """
        将 DataFrame 保存为 CSV（覆盖写）。

        :param df:        DataFrame
        :param file_path: 输出路径
        :param encoding:  文件编码，默认 utf-8-sig（Excel 可直接识别中文）
        :param index:     是否写入行索引
        :param sep:       分隔符
        :return: 实际保存路径
        """
        cls._ensure_dir(file_path)
        df.to_csv(file_path, index=index, encoding=encoding, sep=sep)
        logger.debug("CSV 已保存: %s，共 %d 行", file_path, len(df))
        return file_path

    @classmethod
    def append(cls, df: pd.DataFrame,
               file_path: str,
               encoding: str = 'utf-8-sig',
               index: bool = False) -> str:
        """
        追加写入 CSV：文件存在则不写表头，否则新建。

        :param df:        DataFrame
        :param file_path: 目标文件路径
        :param encoding:  文件编码
        :param index:     是否写入行索引
        :return: 实际保存路径
        """
        cls._ensure_dir(file_path)
        file_exists = os.path.exists(file_path)
        df.to_csv(file_path, mode='a', header=not file_exists,
                  index=index, encoding=encoding)
        logger.debug("CSV 追加完成: %s，追加 %d 行", file_path, len(df))
        return file_path

    @classmethod
    def save_from_json_str(cls, json_str: str, file_path: str,
                           encoding: str = 'utf-8-sig') -> str:
        """
        将 JSON 字符串直接写为 CSV 文件。

        :param json_str:  JSON 字符串
        :param file_path: 输出路径
        :param encoding:  文件编码
        :return: 实际保存路径
        """
        df = cls.read_from_json_str(json_str)
        return cls.save(df, file_path, encoding=encoding)

    # ------------------------------------------------------------------ #
    #  三、列操作                                                           #
    # ------------------------------------------------------------------ #

    @staticmethod
    def add_column(df: pd.DataFrame, col_name: str, value: Any) -> pd.DataFrame:
        """
        新增列，value 可以是标量或与 df 等长的列表/Series。

        :param df:       DataFrame
        :param col_name: 列名
        :param value:    列数据
        :return: 新 DataFrame（不修改原始对象）
        """
        df = df.copy()
        df[col_name] = value
        return df

    @staticmethod
    def drop_columns(df: pd.DataFrame, cols: List[str]) -> pd.DataFrame:
        """
        删除指定列。

        :param df:   DataFrame
        :param cols: 待删除的列名列表
        :return: 新 DataFrame
        """
        return df.drop(columns=cols, errors='ignore')

    @staticmethod
    def rename_columns(df: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
        """
        重命名列。

        :param df:      DataFrame
        :param mapping: 旧列名 -> 新列名 的字典
        :return: 新 DataFrame
        """
        return df.rename(columns=mapping)

    @staticmethod
    def reorder_columns(df: pd.DataFrame, cols: List[str]) -> pd.DataFrame:
        """
        按指定顺序调整列顺序，不在列表中的列追加到末尾。

        :param df:   DataFrame
        :param cols: 期望的列顺序
        :return: 新 DataFrame
        """
        remaining = [c for c in df.columns if c not in cols]
        return df[cols + remaining]

    # ------------------------------------------------------------------ #
    #  四、行过滤 / 查询                                                    #
    # ------------------------------------------------------------------ #

    @staticmethod
    def filter_by(df: pd.DataFrame, conditions: Dict[str, Any]) -> pd.DataFrame:
        """
        按字典条件做等值过滤（多条件为 AND 关系）。

        :param df:         DataFrame
        :param conditions: 如 {'city': '北京', 'age': 18}
        :return: 过滤后的 DataFrame
        """
        mask = pd.Series([True] * len(df), index=df.index)
        for col, val in conditions.items():
            if col in df.columns:
                mask &= df[col] == val
        return df[mask]

    @staticmethod
    def query(df: pd.DataFrame, expr: str) -> pd.DataFrame:
        """
        使用 pandas query 表达式过滤，支持复杂条件。

        :param df:   DataFrame
        :param expr: 如 'age > 18 and city == "北京"'
        :return: 过滤后的 DataFrame
        """
        return df.query(expr)

    @staticmethod
    def search_column(df: pd.DataFrame, col: str, keyword: str) -> pd.DataFrame:
        """
        对指定列做字符串模糊匹配（contains）。

        :param df:      DataFrame
        :param col:     列名
        :param keyword: 关键词
        :return: 匹配行
        """
        return df[df[col].astype(str).str.contains(keyword, na=False)]

    # ------------------------------------------------------------------ #
    #  五、数据清洗                                                         #
    # ------------------------------------------------------------------ #

    @staticmethod
    def drop_duplicates(df: pd.DataFrame,
                        subset: Optional[List[str]] = None,
                        keep: str = 'first') -> pd.DataFrame:
        """
        删除重复行。

        :param df:     DataFrame
        :param subset: 用于判断重复的列，None 表示全部列
        :param keep:   保留策略：'first' | 'last' | False
        :return: 去重后的 DataFrame
        """
        return df.drop_duplicates(subset=subset, keep=keep)

    @staticmethod
    def fill_na(df: pd.DataFrame, value: Union[Any, Dict[str, Any]]) -> pd.DataFrame:
        """
        填充空值。

        :param df:    DataFrame
        :param value: 标量（所有列统一填充）或字典（按列填充）
        :return: 填充后的 DataFrame
        """
        return df.fillna(value)

    @staticmethod
    def drop_na(df: pd.DataFrame,
                subset: Optional[List[str]] = None) -> pd.DataFrame:
        """
        删除含空值的行。

        :param df:     DataFrame
        :param subset: 只检查指定列，None 表示任意列含空则删
        :return: 清除空值后的 DataFrame
        """
        return df.dropna(subset=subset)

    @staticmethod
    def cast_types(df: pd.DataFrame, dtype_map: Dict[str, Any]) -> pd.DataFrame:
        """
        批量转换列类型。

        :param df:        DataFrame
        :param dtype_map: 如 {'age': int, 'score': float, 'date': 'datetime64[ns]'}
        :return: 转换后的 DataFrame
        """
        return df.astype(dtype_map, errors='ignore')

    # ------------------------------------------------------------------ #
    #  六、排序 & 分页                                                      #
    # ------------------------------------------------------------------ #

    @staticmethod
    def sort(df: pd.DataFrame,
             by: Union[str, List[str]],
             ascending: Union[bool, List[bool]] = True) -> pd.DataFrame:
        """
        排序。

        :param df:        DataFrame
        :param by:        排序列名或列名列表
        :param ascending: True 升序，False 降序；列表与 by 对应
        :return: 排序后的 DataFrame
        """
        return df.sort_values(by=by, ascending=ascending)

    @staticmethod
    def page(df: pd.DataFrame, page_num: int = 1, page_size: int = 10) -> pd.DataFrame:
        """
        按页返回数据（1-based）。

        :param df:        DataFrame
        :param page_num:  页码，从 1 开始
        :param page_size: 每页行数
        :return: 当前页的 DataFrame
        """
        start = (page_num - 1) * page_size
        return df.iloc[start: start + page_size]

    # ------------------------------------------------------------------ #
    #  七、统计汇总                                                         #
    # ------------------------------------------------------------------ #

    @staticmethod
    def summary(df: pd.DataFrame) -> pd.DataFrame:
        """
        输出数值列的描述性统计（count/mean/std/min/max 等）。

        :param df: DataFrame
        :return: 统计 DataFrame
        """
        return df.describe(include='all')

    @staticmethod
    def group_agg(df: pd.DataFrame,
                  group_by: Union[str, List[str]],
                  agg: Dict[str, Union[str, List[str]]]) -> pd.DataFrame:
        """
        分组聚合。

        :param df:       DataFrame
        :param group_by: 分组列名或列名列表
        :param agg:      聚合字典，如 {'score': 'mean', 'age': ['min', 'max']}
        :return: 聚合结果 DataFrame
        """
        return df.groupby(group_by).agg(agg).reset_index()

    @staticmethod
    def value_counts(df: pd.DataFrame, col: str) -> pd.DataFrame:
        """
        统计指定列各值出现次数，降序排列。

        :param df:  DataFrame
        :param col: 列名
        :return: 含 value / count 两列的 DataFrame
        """
        vc = df[col].value_counts().reset_index()
        vc.columns = ['value', 'count']
        return vc

    # ------------------------------------------------------------------ #
    #  八、合并                                                             #
    # ------------------------------------------------------------------ #

    @staticmethod
    def concat_rows(*dfs: pd.DataFrame, ignore_index: bool = True) -> pd.DataFrame:
        """
        纵向合并多个 DataFrame（行追加）。

        :param dfs:          多个 DataFrame
        :param ignore_index: 是否重置索引
        :return: 合并后的 DataFrame
        """
        return pd.concat(list(dfs), ignore_index=ignore_index)

    @staticmethod
    def merge(left: pd.DataFrame, right: pd.DataFrame,
              on: Union[str, List[str]],
              how: str = 'inner') -> pd.DataFrame:
        """
        横向合并两个 DataFrame（类似 SQL JOIN）。

        :param left:  左 DataFrame
        :param right: 右 DataFrame
        :param on:    连接键列名
        :param how:   连接方式：'inner' | 'left' | 'right' | 'outer'
        :return: 合并后的 DataFrame
        """
        return pd.merge(left, right, on=on, how=how)

    # ------------------------------------------------------------------ #
    #  九、格式转换                                                         #
    # ------------------------------------------------------------------ #

    @staticmethod
    def to_json_str(df: pd.DataFrame,
                    orient: str = 'records',
                    ensure_ascii: bool = False) -> str:
        """
        DataFrame 转 JSON 字符串。

        :param df:           DataFrame
        :param orient:       JSON 格式：'records' | 'dict' | 'split' 等
        :param ensure_ascii: False 则中文不转义
        :return: JSON 字符串
        """
        return df.to_json(orient=orient, force_ascii=ensure_ascii)

    @staticmethod
    def to_dict_list(df: pd.DataFrame) -> List[Dict]:
        """
        DataFrame 转字典列表。

        :param df: DataFrame
        :return: list of dict
        """
        return df.to_dict(orient='records')

    @staticmethod
    def from_dict_list(data: List[Dict]) -> pd.DataFrame:
        """
        字典列表转 DataFrame。

        :param data: list of dict
        :return: DataFrame
        """
        return pd.DataFrame(data)


# ====================================================================== #
#  使用示例                                                               #
# ====================================================================== #
def demo_case():
    BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
    CSV_OUT   = os.path.join(BASE_DIR, '../data/csv/output.csv')
    CSV_APPEND = os.path.join(BASE_DIR, '../data/csv/append_test.csv')

    utils = CsvPandasUtils()

    # ------------------------------------------------------------------
    # 示例 1：从 JSON 字符串创建并保存 CSV
    # ------------------------------------------------------------------
    json_data = '''
    [
        {"name": "张三", "age": 25, "city": "北京",   "score": 88.5},
        {"name": "李四", "age": 30, "city": "上海",   "score": 92.0},
        {"name": "王五", "age": 22, "city": "北京",   "score": 75.0},
        {"name": "赵六", "age": 28, "city": "广州",   "score": 65.5},
        {"name": "陈七", "age": 35, "city": "上海",   "score": 95.0},
        {"name": "李四", "age": 30, "city": "上海",   "score": 92.0}
    ]
    '''
    print('\n===== 示例 1：JSON 字符串 -> 保存 CSV =====')
    df = utils.read_from_json_str(json_data)
    print(df)
    utils.save(df, CSV_OUT)
    print(f'已保存到: {CSV_OUT}')

    # ------------------------------------------------------------------
    # 示例 2：读取 CSV
    # ------------------------------------------------------------------
    print('\n===== 示例 2：读取 CSV =====')
    df = utils.read(CSV_OUT)
    print(df)

    # ------------------------------------------------------------------
    # 示例 3：列操作（新增 / 删除 / 重命名 / 调整顺序）
    # ------------------------------------------------------------------
    print('\n===== 示例 3：列操作 =====')
    df3 = utils.add_column(
        df, 'grade',
        df['score'].apply(lambda s: 'A' if s >= 90 else ('B' if s >= 75 else 'C'))
    )
    df3 = utils.rename_columns(df3, {'name': '姓名', 'age': '年龄',
                                      'city': '城市', 'score': '分数', 'grade': '等级'})
    df3 = utils.reorder_columns(df3, ['姓名', '城市', '等级', '分数', '年龄'])
    print(df3)

    # ------------------------------------------------------------------
    # 示例 4：过滤 / 查询
    # ------------------------------------------------------------------
    print('\n===== 示例 4：等值过滤 city=北京 =====')
    print(utils.filter_by(df, {'city': '北京'}))

    print('\n===== 示例 4：query 表达式 score>80 =====')
    print(utils.query(df, 'score > 80'))

    print('\n===== 示例 4：模糊搜索 name 含"李" =====')
    print(utils.search_column(df, 'name', '李'))

    # ------------------------------------------------------------------
    # 示例 5：去重
    # ------------------------------------------------------------------
    print('\n===== 示例 5：去重（按 name+city）=====')
    print(utils.drop_duplicates(df, subset=['name', 'city']))

    # ------------------------------------------------------------------
    # 示例 6：排序 & 分页
    # ------------------------------------------------------------------
    print('\n===== 示例 6：按 score 降序 =====')
    print(utils.sort(df, by='score', ascending=False))

    print('\n===== 示例 6：分页 page=1, size=3 =====')
    print(utils.page(df, page_num=1, page_size=3))

    # ------------------------------------------------------------------
    # 示例 7：统计汇总
    # ------------------------------------------------------------------
    print('\n===== 示例 7：city 分布计数 =====')
    print(utils.value_counts(df, 'city'))

    print('\n===== 示例 7：按 city 分组，score 均值 =====')
    print(utils.group_agg(df, group_by='city', agg={'score': 'mean'}))

    # ------------------------------------------------------------------
    # 示例 8：追加写入 CSV
    # ------------------------------------------------------------------
    print('\n===== 示例 8：追加写入 =====')
    new_rows = utils.from_dict_list([
        {'name': '新用户A', 'age': 20, 'city': '深圳', 'score': 80.0},
    ])
    utils.append(new_rows, CSV_APPEND)
    utils.append(new_rows, CSV_APPEND)   # 再追加一次，验证不重复写 header
    print(utils.read(CSV_APPEND))

    # ------------------------------------------------------------------
    # 示例 9：合并多个 DataFrame
    # ------------------------------------------------------------------
    print('\n===== 示例 9：纵向合并 =====')
    df_a = utils.from_dict_list([{'id': 1, 'val': 'A'}])
    df_b = utils.from_dict_list([{'id': 2, 'val': 'B'}])
    print(utils.concat_rows(df_a, df_b))

    print('\n===== 示例 9：横向 JOIN =====')
    df_left  = utils.from_dict_list([{'id': 1, 'name': '张三'}, {'id': 2, 'name': '李四'}])
    df_right = utils.from_dict_list([{'id': 1, 'dept': '技术部'}, {'id': 2, 'dept': '销售部'}])
    print(utils.merge(df_left, df_right, on='id'))

    # ------------------------------------------------------------------
    # 示例 10：格式转换
    # ------------------------------------------------------------------
    print('\n===== 示例 10：DataFrame -> JSON 字符串 =====')
    print(utils.to_json_str(df))

    print('\n===== 示例 10：DataFrame -> dict 列表 =====')
    for row in utils.to_dict_list(df):
        print(row)


if __name__ == '__main__':
    print("main init")
    # demo_case()
    
