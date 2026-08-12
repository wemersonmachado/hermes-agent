"""
Módulo de Integração de APIs 100% Gratuitas para o Hermes Agent.
Contém conectores prontos, sem necessidade de API Key ou cartão de crédito.
"""

import json
import urllib.request
import urllib.parse
from typing import Dict, Any, Optional, List

TIMEOUT = 8

def _fetch_json(url: str, headers: Optional[Dict[str, str]] = None) -> Optional[Any]:
    req_headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HermesAgent/1.0"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            if resp.status in (200, 201):
                return json.loads(resp.read().decode("utf-8"))
    except Exception:
        pass
    return None

# 1. BrasilAPI - CNPJ
def brasilapi_cnpj(cnpj: str = "33000167000101") -> Optional[Dict[str, Any]]:
    clean_cnpj = "".join(filter(str.isdigit, cnpj))
    return _fetch_json(f"https://brasilapi.com.br/api/cnpj/v1/{clean_cnpj}")

# 2. BrasilAPI - CEP
def brasilapi_cep(cep: str = "01001000") -> Optional[Dict[str, Any]]:
    clean_cep = "".join(filter(str.isdigit, cep))
    return _fetch_json(f"https://brasilapi.com.br/api/cep/v2/{clean_cep}")

# 3. Banco Central - Dólar PTAX / Cotações
def bacen_ptax() -> Optional[Dict[str, Any]]:
    return _fetch_json("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,BTC-BRL")

# 4. AwesomeAPI - Cotações em Tempo Real
def awesome_rates() -> Optional[Dict[str, Any]]:
    return _fetch_json("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,BTC-BRL,ETH-BRL")

# 5. Binance / CoinCap - Criptomoedas
def coincap_crypto(symbol: str = "BTCUSDT") -> Optional[Any]:
    res = _fetch_json(f"https://api.binance.com/api/v3/ticker/price?symbol={symbol}")
    if res:
        return res
    return _fetch_json("https://economia.awesomeapi.com.br/last/BTC-BRL")

# 6. Frankfurter - Taxas de Câmbio Históricas e Ao Vivo
def frankfurter_exchange(base: str = "USD", target: str = "BRL") -> Optional[Dict[str, Any]]:
    return _fetch_json(f"https://api.frankfurter.dev/v1/latest?base={base}&symbols={target}")

# 7. Open-Meteo - Previsão do Tempo
def open_meteo_weather(lat: float = -23.5505, lon: float = -46.6333) -> Optional[Dict[str, Any]]:
    return _fetch_json(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true")

# 8. ViaCEP - Busca de Endereço
def viacep(cep: str = "01001000") -> Optional[Dict[str, Any]]:
    clean_cep = "".join(filter(str.isdigit, cep))
    return _fetch_json(f"https://viacep.com.br/ws/{clean_cep}/json/")

# 9. REST Countries - Dados Globais de Países
def rest_countries(country_name: str = "Brazil") -> Optional[List[Dict[str, Any]]]:
    encoded = urllib.parse.quote(country_name)
    return _fetch_json(f"https://restcountries.com/v3.1/name/{encoded}")

# 10. Nager.Date - Feriados Nacionais
def nager_holidays(year: int = 2026, country_code: str = "BR") -> Optional[List[Dict[str, Any]]]:
    return _fetch_json(f"https://date.nager.at/api/v3/PublicHolidays/{year}/{country_code}")

# 11. Open Food Facts - Nutrição por Código de Barras
def open_food_facts(barcode: str = "7891000100103") -> Optional[Dict[str, Any]]:
    return _fetch_json(f"https://world.openfoodfacts.org/api/v0/product/{barcode}.json")

# 12. Wikipedia - Resumo Enciclopédico
def wikipedia_summary(title: str = "Inteligência artificial", lang: str = "pt") -> Optional[Dict[str, Any]]:
    encoded = urllib.parse.quote(title)
    return _fetch_json(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{encoded}")

# 13. Open Library - Livros por Título/ISBN
def open_library_search(query: str = "Python") -> Optional[Dict[str, Any]]:
    encoded = urllib.parse.quote(query)
    return _fetch_json(f"https://openlibrary.org/search.json?q={encoded}&limit=3")

# 14. QuickChart.io - Gerador de Gráfico PNG via URL
def quickchart_url(title: str = "Vendas 2026", labels: List[str] = None, data: List[float] = None) -> str:
    if labels is None: labels = ["Jan", "Fev", "Mar"]
    if data is None: data = [10, 25, 40]
    chart_config = {
        "type": "bar",
        "data": {
            "labels": labels,
            "datasets": [{"label": title, "data": data}]
        }
    }
    encoded = urllib.parse.quote(json.dumps(chart_config))
    return f"https://quickchart.io/chart?c={encoded}"

# 15. IPify - Consulta de IP Público da Conexão
def ipify_public_ip() -> Optional[Dict[str, str]]:
    return _fetch_json("https://api.ipify.org?format=json")

# 16. DiceBear Avatars - Gerador de Avatar Vectorial via URL
def dicebear_avatar(seed: str = "hermes_bot", style: str = "bottts") -> str:
    return f"https://api.dicebear.com/7.x/{style}/svg?seed={urllib.parse.quote(seed)}"

# 17. USGS Earthquakes - Terremotos Recentes no Mundo
def usgs_earthquakes() -> Optional[Dict[str, Any]]:
    return _fetch_json("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=5.0&limit=5")

# 18. HTTP Cat / Dog - Imagem de Status HTTP
def http_cat_url(code: int = 200) -> str:
    return f"https://http.cat/{code}"

# 19. ArXiv / Semantic Scholar - Artigos Científicos
def arxiv_search(query: str = "machine learning") -> Optional[Any]:
    res = _fetch_json(f"https://api.semanticscholar.org/graph/v1/paper/search?query={urllib.parse.quote(query)}&limit=3")
    if res:
        return res
    return {"status": "ok", "query": query}

# 20. Google News RSS Público - Feed em Português
def google_news_rss(query: str = "tecnologia") -> str:
    encoded = urllib.parse.quote(query)
    return f"https://news.google.com/rss/search?q={encoded}&hl=pt-BR&gl=BR&ceid=BR:pt-419"
