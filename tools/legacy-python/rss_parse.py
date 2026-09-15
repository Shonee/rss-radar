# [归档参考实现] 原 rss_private 项目脚本，原样复制于此作历史参考；不参与 CI/构建，不保证可运行。
import requests
import feedparser
import time
from datetime import datetime, timedelta

# 定义你喜欢的博客的RSS链接地址 # 添加更多博客的RSS链接
rss_feeds_str = '''
    https://www.ruanyifeng.com/blog/atom.xml,
    https://iao.su/feed,
    https://www.appinn.com/,
    https://www.52pojie.cn/forum.php?mod=guide&view=hot&rss=1,
    https://tech.meituan.com/feed/,
    https://rss.csdn.net/ctrip_tech/rss/map,
    https://xueqiu.com/hots/topic/rss,
    http://www.woshipm.com/category/pmd/feed,
    https://www.wpdaxue.com/feed,
    https://movie.douban.com/review/movie_best,
    https://www.douban.com/feed/review/book
'''
rss_feeds = [rss.strip() for rss in rss_feeds_str.split(',') if rss.strip()]
print("RSS Feeds:", rss_feeds)

lastdays = 1
# 获取当前时间
now = datetime.now()
# 获取今天零点的时间
zero_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
last_datetime = zero_today - timedelta(days=lastdays)
print("last_datetime:", last_datetime)


def get_rss_feed_form_feishu_bitable(bitable_url):
    from feishu_bitable_utils import bitable_get_info
    info = bitable_get_info(bitable_url)
    print(info)


def parse_articles_from_feed(feed_url):
    print("开始解析: "+feed_url)
    response = requests.get(feed_url, timeout=10)
    # response.raise_for_status()
    if response.status_code != 200:
        print(f"解析失败: {feed_url}, 返回状态: {response.status_code}")
        return None

    feed = feedparser.parse(response.text)

    articles = []
    rss_title = feed.feed.get('title', '')
    if 'entries' in feed:
        for entry in feed.entries:
            if entry.get('published_parsed') and datetime.fromtimestamp(time.mktime(entry['published_parsed'])) >= last_datetime:
                article = {
                    'rss_title': rss_title,
                    'title': entry.get('title', ''),
                    'link': entry.get('link', ''),
                    'published': entry.get('published', ''),
                    # 可以根据需要提取更多信息，如作者、摘要等
                }
                articles.append(article)
    print("解析成功: " + feed_url, "文章数：" + str(len(articles)))
    return articles

def batch_parse_feed(rss_feeds: list):
    # articles = [item for feed_url in rss_feeds for item in fetch_articles_from_feed(feed_url) ]
    articles = []
    for feed_url in rss_feeds:
        sub_articles = parse_articles_from_feed(feed_url)
        if sub_articles:
            articles.extend(sub_articles)

    print("共获取到文章数：", len(articles))
    # print("所有文章列表：", articles)
    return articles

def json2md(articles: list):
    content = ''
    for index, article in enumerate(articles, start=1):
        content += f"{index}. [{article.get('title')} - {article.get('rss_title')}]({article.get('link')}) \n\n"
    print(content)



if __name__ == '__main__':

    bitable_url = 'https://ginvh09pnwq.feishu.cn/base/IBNMbVJUuaKcgasQwMKc4eamnad?table=tblqLc4E03M5Uoh3&view=vewoYD3rcM'
    result = get_rss_feed_form_feishu_bitable(bitable_url)

    # articles = batch_parse_feed(rss_feeds)
    # json2md(articles)

    

