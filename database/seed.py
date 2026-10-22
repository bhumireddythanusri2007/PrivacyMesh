"""
PrivacyMesh Database Seeding Script
Populates initial demo data for demonstration purposes if records do not already exist.
"""

import os
import sys

# Ensure backend app is importable
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.database import SessionLocal, engine, Base
from app.models import User, Transaction, KYCRecord
from app.security import hash_password


def seed_database():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # Check or create default admin
        admin_user = db.query(User).filter(User.username == "privacy_admin").first()
        if not admin_user:
            admin_user = User(
                username="privacy_admin",
                password_hash=hash_password("AdminSecure2026!"),
                role="admin",
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
            print("Created default admin user: privacy_admin")
        else:
            print("Default admin user already exists.")

        # Check or create default demo user
        demo_user = db.query(User).filter(User.username == "demo_student").first()
        if not demo_user:
            demo_user = User(
                username="demo_student",
                password_hash=hash_password("StudentSecure2026!"),
                role="user",
            )
            db.add(demo_user)
            db.commit()
            db.refresh(demo_user)
            print("Created default demo user: demo_student")
        else:
            print("Default demo user already exists.")

        # Check or seed a demo transaction
        txn_count = db.query(Transaction).filter(Transaction.user_id == demo_user.id).count()
        if txn_count == 0:
            demo_txn = Transaction(
                user_id=demo_user.id,
                account_id="ACC-DEMO-1001",
                amount=5000.00,
                transaction_type="deposit",
                status="completed",
            )
            db.add(demo_txn)
            db.commit()
            print("Created demo transaction for demo_student.")

        # Check or seed a demo KYC record
        kyc_count = db.query(KYCRecord).filter(KYCRecord.user_id == demo_user.id).count()
        if kyc_count == 0:
            demo_kyc = KYCRecord(
                user_id=demo_user.id,
                customer_ref="CUST-SEED-001",
                document_type="Passport",
                verification_status="verified",
                risk_category="low",
            )
            db.add(demo_kyc)
            db.commit()
            print("Created demo KYC record for demo_student.")

        print("Database seeding completed successfully.")

    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
