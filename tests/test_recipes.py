import pytest
from app import create_app, db

@pytest.fixture
def client():
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    with app.test_client() as client:
        with app.app_context():
            db.create_all()
        yield client

def test_create_and_list_recipe(client):
    resp = client.post("/api/recipes/", json={
        "name": "Grilled Chicken",
        "calories": 300,
        "protein_g": 40,
        "carbs_g": 0,
        "fat_g": 10,
        "meal_type": "dinner",
    })
    assert resp.status_code == 201

    resp = client.get("/api/recipes/")
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data) == 1
    assert data[0]["name"] == "Grilled Chicken"
