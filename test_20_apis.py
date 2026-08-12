"""
Script de Teste de Integração em Tempo Real para as 20 APIs Públicas do Hermes.
"""

import os
import sys

# Adicionar o diretório de tools ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from tools import free_apis_helper as apis

def run_tests():
    print("==========================================================")
    print(" 🚀 AUDITORIA & TESTE DE EXECUÇÃO EM TEMPO REAL: 20 APIS  ")
    print("==========================================================")

    results = {}

    # 1. BrasilAPI - CEP
    cep_res = apis.brasilapi_cep("01001000")
    results["1. BrasilAPI CEP"] = "OK ✅" if cep_res and "street" in cep_res else "FALHOU ❌"

    # 2. AwesomeAPI Câmbio
    rates_res = apis.awesome_rates()
    results["2. AwesomeAPI Câmbio"] = "OK ✅" if rates_res and "USDBRL" in rates_res else "FALHOU ❌"

    # 3. Frankfurter Exchange
    frank_res = apis.frankfurter_exchange()
    results["3. Frankfurter Exchange"] = "OK ✅" if frank_res and "rates" in frank_res else "FALHOU ❌"

    # 4. CoinCap / Binance Cripto
    coin_res = apis.coincap_crypto()
    results["4. CoinCap / Binance Cripto"] = "OK ✅" if coin_res and ("price" in coin_res or "data" in coin_res or "BTCBRL" in coin_res) else "FALHOU ❌"

    # 5. Open-Meteo Clima
    weather_res = apis.open_meteo_weather()
    results["5. Open-Meteo Clima"] = "OK ✅" if weather_res and "current_weather" in weather_res else "FALHOU ❌"

    # 6. ViaCEP Endereços
    via_res = apis.viacep("01001000")
    results["6. ViaCEP"] = "OK ✅" if via_res and "logradouro" in via_res else "FALHOU ❌"

    # 7. REST Countries
    country_res = apis.rest_countries("Brazil")
    results["7. REST Countries"] = "OK ✅" if country_res and len(country_res) > 0 else "FALHOU ❌"

    # 8. Nager.Date Feriados
    holiday_res = apis.nager_holidays()
    results["8. Nager.Date Feriados"] = "OK ✅" if holiday_res and isinstance(holiday_res, list) else "FALHOU ❌"

    # 9. Open Food Facts
    food_res = apis.open_food_facts("7891000100103")
    results["9. Open Food Facts"] = "OK ✅" if food_res and "status" in food_res else "FALHOU ❌"

    # 10. Wikipedia Summary
    wiki_res = apis.wikipedia_summary("Inteligência artificial")
    results["10. Wikipedia REST"] = "OK ✅" if wiki_res and "extract" in wiki_res else "FALHOU ❌"

    # 11. Open Library
    book_res = apis.open_library_search("Python")
    results["11. Open Library"] = "OK ✅" if book_res and "docs" in book_res else "FALHOU ❌"

    # 12. QuickChart.io
    chart_url = apis.quickchart_url("Vendas 2026", ["Jan", "Fev", "Mar"], [10, 25, 40])
    results["12. QuickChart.io"] = "OK ✅" if "quickchart.io" in chart_url else "FALHOU ❌"

    # 13. IPify IP Público
    ip_res = apis.ipify_public_ip()
    results["13. IPify IP"] = "OK ✅" if ip_res and "ip" in ip_res else "FALHOU ❌"

    # 14. DiceBear Avatars
    avatar_url = apis.dicebear_avatar("hermes_bot")
    results["14. DiceBear Avatars"] = "OK ✅" if "dicebear.com" in avatar_url else "FALHOU ❌"

    # 15. USGS Earthquakes
    eq_res = apis.usgs_earthquakes()
    results["15. USGS Earthquakes"] = "OK ✅" if eq_res and "features" in eq_res else "FALHOU ❌"

    # 16. HTTP Cat Status
    cat_url = apis.http_cat_url(200)
    results["16. HTTP Cat"] = "OK ✅" if "http.cat/200" in cat_url else "FALHOU ❌"

    # 17. Google News RSS
    news_url = apis.google_news_rss("Inteligencia Artificial")
    results["17. Google News RSS"] = "OK ✅" if "news.google.com" in news_url else "FALHOU ❌"

    # 18. BrasilAPI - CNPJ (Petrobras)
    cnpj_res = apis.brasilapi_cnpj("33000167000101")
    results["18. BrasilAPI CNPJ"] = "OK ✅" if cnpj_res and "razao_social" in cnpj_res else "FALHOU ❌"

    # 19. BACEN PTAX / Cotacao
    bacen_res = apis.bacen_ptax()
    results["19. BACEN / PTAX"] = "OK ✅" if bacen_res else "FALHOU ❌"

    # 20. ArXiv Papers
    arxiv_res = apis.arxiv_search("machine learning")
    results["20. ArXiv Science"] = "OK ✅" if arxiv_res else "FALHOU ❌"

    print("\n--- RESULTADOS DO TESTE DAS 20 APIS ---")
    for api_name, status in results.items():
        print(f" • {api_name}: {status}")

if __name__ == "__main__":
    run_tests()
