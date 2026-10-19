"""Dados fictícios no mesmo formato interno que o TOTVS gera (para demo sem credenciais)."""
import random

_REFS = [
    # ref, nome, grupo, preço atacado, cores, tamanhos
    ("10421", "Body Manga Curta Canelado", "Bebê", 24.90, ["Off White", "Rosa Bebê", "Azul Névoa"], ["RN", "P", "M", "G"]),
    ("10422", "Body Manga Longa Suedine", "Bebê", 29.90, ["Mescla", "Verde Sálvia", "Off White"], ["RN", "P", "M", "G"]),
    ("10455", "Macacão Plush com Pezinho", "Bebê", 54.90, ["Bege", "Rosa Bebê"], ["RN", "P", "M", "G"]),
    ("10470", "Kit 3 Culotes Suedine", "Bebê", 39.90, ["Neutros", "Coloridos"], ["P", "M", "G"]),
    ("20110", "Conjunto Moletinho Urso", "Infantil", 69.90, ["Caramelo", "Marinho"], ["1", "2", "3", "4"]),
    ("20118", "Conjunto Verão Linho", "Infantil", 74.90, ["Areia", "Terracota"], ["1", "2", "3", "4", "6"]),
    ("20140", "Vestido Lese Babado", "Infantil", 79.90, ["Branco", "Lavanda", "Amarelo Manteiga"], ["1", "2", "3", "4", "6", "8"]),
    ("20152", "Jardineira Sarja", "Infantil", 84.90, ["Jeans Claro", "Caqui"], ["1", "2", "3", "4"]),
    ("20166", "Camiseta Estampada Dino", "Infantil", 32.90, ["Verde", "Cinza Mescla"], ["2", "4", "6", "8", "10"]),
    ("20171", "Bermuda Moletom", "Infantil", 36.90, ["Marinho", "Mescla", "Preto"], ["2", "4", "6", "8", "10"]),
    ("20190", "Pijama Malha Estrelinhas", "Infantil", 49.90, ["Azul", "Rosa"], ["1", "2", "4", "6", "8"]),
    ("30012", "Saída de Maternidade Tricô", "Maternidade", 119.90, ["Off White", "Cru"], ["RN"]),
    ("30020", "Manta Soft Bordada", "Maternidade", 64.90, ["Cinza", "Bege", "Rosa"], ["U"]),
    ("30031", "Kit Touca + Luva + Meia", "Maternidade", 27.90, ["Branco", "Azul", "Rosa"], ["RN", "P"]),
]


def mock_skus() -> list[dict]:
    rnd = random.Random(42)  # determinístico: mesmo estoque em toda execução
    out = []
    code = 100000
    for ref, name, group, price, colors, sizes in _REFS:
        for color in colors:
            for size in sizes:
                code += 1
                available = rnd.choice([0, 0, 3, 5, 8, 12, 18, 24, 36, 48, 60])
                out.append({
                    "productCode": code, "reference": ref, "name": name, "color": color,
                    "colorCode": "", "size": size, "available": available, "price": price, "group": group,
                    "retailPrice": round(price * 1.67, 1) - 0.01,  # varejo ~ atacado + 67%, como no TOTVS
                })
    return out
