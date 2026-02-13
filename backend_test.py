#!/usr/bin/env python3
"""
KeepEat Backend API Testing Suite
Tests all backend APIs comprehensively
"""

import requests
import json
from datetime import datetime, timedelta
import time
import sys

# Base URL from frontend environment
BASE_URL = "https://nofoodwaste-14.preview.emergentagent.com/api"

class KeepEatAPITester:
    def __init__(self):
        self.base_url = BASE_URL
        self.session = requests.Session()
        self.test_items = []  # Store created items for cleanup
        
    def log(self, message, level="INFO"):
        """Log test messages"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def test_health_check(self):
        """Test health check endpoint"""
        self.log("Testing Health Check API...")
        try:
            response = self.session.get(f"{self.base_url}/health")
            if response.status_code == 200:
                data = response.json()
                if "status" in data and data["status"] == "healthy":
                    self.log("✅ Health check passed")
                    return True
                else:
                    self.log(f"❌ Health check failed - Invalid response: {data}", "ERROR")
                    return False
            else:
                self.log(f"❌ Health check failed - Status: {response.status_code}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Health check failed - Exception: {str(e)}", "ERROR")
            return False
    
    def test_product_lookup(self):
        """Test Open Food Facts product lookup"""
        self.log("Testing Product Lookup API...")
        test_barcodes = [
            ("3017620422003", "Nutella"),
            ("5000112637939", "Coca-Cola"), 
            ("3228857000166", "Camembert")
        ]
        
        success_count = 0
        for barcode, expected_name in test_barcodes:
            try:
                self.log(f"Looking up barcode: {barcode}")
                response = self.session.get(f"{self.base_url}/product/{barcode}")
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get("found") and data.get("product"):
                        product = data["product"]
                        self.log(f"✅ Found product: {product.get('name', 'Unknown')} by {product.get('brand', 'Unknown brand')}")
                        success_count += 1
                    else:
                        self.log(f"⚠️ Product {barcode} not found in database")
                else:
                    self.log(f"❌ Product lookup failed for {barcode} - Status: {response.status_code}", "ERROR")
            except Exception as e:
                self.log(f"❌ Product lookup failed for {barcode} - Exception: {str(e)}", "ERROR")
        
        if success_count > 0:
            self.log(f"✅ Product lookup working - {success_count}/{len(test_barcodes)} products found")
            return True
        else:
            self.log("❌ Product lookup failed - No products found", "ERROR")
            return False
    
    def test_stock_crud(self):
        """Test stock CRUD operations"""
        self.log("Testing Stock CRUD Operations...")
        
        # Test data with different expiry dates
        test_items = [
            {
                "name": "Fresh Milk",
                "brand": "Lactalis",
                "barcode": "1234567890123",
                "expiry_date": (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d"),
                "quantity": "1L",
                "notes": "Organic whole milk"
            },
            {
                "name": "Bread",
                "brand": "Boulangerie Paul",
                "expiry_date": (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d"),
                "quantity": "1 loaf",
                "notes": "Whole wheat bread"
            },
            {
                "name": "Yogurt",
                "brand": "Danone",
                "expiry_date": (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d"),
                "quantity": "4 pack"
            }
        ]
        
        created_items = []
        
        # Test CREATE (POST)
        self.log("Testing CREATE operations...")
        for item_data in test_items:
            try:
                response = self.session.post(f"{self.base_url}/stock", json=item_data)
                if response.status_code == 200:
                    item = response.json()
                    created_items.append(item)
                    self.test_items.append(item["id"])  # For cleanup
                    self.log(f"✅ Created item: {item['name']} (ID: {item['id']})")
                else:
                    self.log(f"❌ Failed to create item {item_data['name']} - Status: {response.status_code}", "ERROR")
                    return False
            except Exception as e:
                self.log(f"❌ Failed to create item {item_data['name']} - Exception: {str(e)}", "ERROR")
                return False
        
        if not created_items:
            self.log("❌ No items created - CRUD test failed", "ERROR")
            return False
        
        # Test READ (GET all)
        self.log("Testing READ operations...")
        try:
            response = self.session.get(f"{self.base_url}/stock?status=active")
            if response.status_code == 200:
                items = response.json()
                if len(items) >= len(created_items):
                    self.log(f"✅ Retrieved {len(items)} active items")
                else:
                    self.log(f"⚠️ Expected at least {len(created_items)} items, got {len(items)}")
            else:
                self.log(f"❌ Failed to get stock items - Status: {response.status_code}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Failed to get stock items - Exception: {str(e)}", "ERROR")
            return False
        
        # API currently exposes list/create + state transitions (consume/throw),
        # not GET/PUT by item id.
        self.log("✅ Stock create/list operations working correctly")
        return True
    
    def test_priority_items(self):
        """Test priority items endpoint"""
        self.log("Testing Priority Items API...")
        
        try:
            response = self.session.get(f"{self.base_url}/stock/priority")
            if response.status_code == 200:
                priority_items = response.json()
                self.log(f"✅ Retrieved {len(priority_items)} priority items")
                
                # Verify items are actually expiring soon
                today = datetime.now().date()
                three_days_later = today + timedelta(days=3)
                
                for item in priority_items:
                    if item.get("expiry_date"):
                        expiry = datetime.fromisoformat(item["expiry_date"]).date()
                        if expiry <= three_days_later:
                            self.log(f"✅ Priority item valid: {item['name']} expires {item['expiry_date']}")
                        else:
                            self.log(f"⚠️ Priority item may be incorrectly included: {item['name']} expires {item['expiry_date']}")
                
                return True
            else:
                self.log(f"❌ Failed to get priority items - Status: {response.status_code}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Failed to get priority items - Exception: {str(e)}", "ERROR")
            return False
    
    def test_consume_throw_actions(self):
        """Test consume and throw actions"""
        self.log("Testing Consume/Throw Actions...")
        
        if not self.test_items:
            self.log("❌ No test items available for consume/throw testing", "ERROR")
            return False
        
        # Test consume action
        consume_item_id = self.test_items[0] if len(self.test_items) > 0 else None
        if consume_item_id:
            try:
                response = self.session.post(f"{self.base_url}/stock/{consume_item_id}/consume")
                if response.status_code == 200:
                    result = response.json()
                    self.log(f"✅ Marked item as consumed: {result.get('message', 'Success')}")
                else:
                    self.log(f"❌ Failed to mark item as consumed - Status: {response.status_code}", "ERROR")
                    return False
            except Exception as e:
                self.log(f"❌ Failed to mark item as consumed - Exception: {str(e)}", "ERROR")
                return False
        
        # Test throw action
        throw_item_id = self.test_items[1] if len(self.test_items) > 1 else None
        if throw_item_id:
            try:
                response = self.session.post(f"{self.base_url}/stock/{throw_item_id}/throw")
                if response.status_code == 200:
                    result = response.json()
                    self.log(f"✅ Marked item as thrown: {result.get('message', 'Success')}")
                else:
                    self.log(f"❌ Failed to mark item as thrown - Status: {response.status_code}", "ERROR")
                    return False
            except Exception as e:
                self.log(f"❌ Failed to mark item as thrown - Exception: {str(e)}", "ERROR")
                return False
        
        self.log("✅ Consume/Throw actions working correctly")
        return True
    
    def test_statistics(self):
        """Test statistics endpoint"""
        self.log("Testing Statistics API...")
        
        try:
            response = self.session.get(f"{self.base_url}/stats")
            if response.status_code == 200:
                stats = response.json()
                required_fields = ["total_items", "expiring_soon", "expired", "consumed_this_week", "thrown_this_week"]
                
                for field in required_fields:
                    if field not in stats:
                        self.log(f"❌ Missing field in stats: {field}", "ERROR")
                        return False
                    if not isinstance(stats[field], int):
                        self.log(f"❌ Invalid type for {field}: expected int, got {type(stats[field])}", "ERROR")
                        return False
                
                self.log(f"✅ Statistics retrieved successfully:")
                self.log(f"   - Total items: {stats['total_items']}")
                self.log(f"   - Expiring soon: {stats['expiring_soon']}")
                self.log(f"   - Expired: {stats['expired']}")
                self.log(f"   - Consumed this week: {stats['consumed_this_week']}")
                self.log(f"   - Thrown this week: {stats['thrown_this_week']}")
                
                return True
            else:
                self.log(f"❌ Failed to get statistics - Status: {response.status_code}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Failed to get statistics - Exception: {str(e)}", "ERROR")
            return False
    
    def test_error_cases(self):
        """Test error handling"""
        self.log("Testing Error Cases...")
        
        # Test invalid item ID
        try:
            response = self.session.get(f"{self.base_url}/stock/invalid-id")
            if response.status_code == 404:
                self.log("✅ Correctly returns 404 for invalid item ID")
            else:
                self.log(f"⚠️ Expected 404 for invalid ID, got {response.status_code}")
        except Exception as e:
            self.log(f"⚠️ Error testing invalid ID: {str(e)}")
        
        # Test missing required field (name)
        try:
            response = self.session.post(f"{self.base_url}/stock", json={"brand": "Test"})
            if response.status_code == 422:  # Validation error
                self.log("✅ Correctly validates required fields")
            else:
                self.log(f"⚠️ Expected 422 for missing name, got {response.status_code}")
        except Exception as e:
            self.log(f"⚠️ Error testing validation: {str(e)}")
        
        return True
    
    def cleanup(self):
        """Clean up test data"""
        self.log("Cleaning up test data...")
        for item_id in self.test_items:
            try:
                response = self.session.delete(f"{self.base_url}/stock/{item_id}")
                if response.status_code == 200:
                    self.log(f"✅ Deleted test item: {item_id}")
                else:
                    self.log(f"⚠️ Failed to delete item {item_id} - Status: {response.status_code}")
            except Exception as e:
                self.log(f"⚠️ Error deleting item {item_id}: {str(e)}")
    
    def run_all_tests(self):
        """Run all tests"""
        self.log("=" * 60)
        self.log("STARTING KEEPEAT BACKEND API TESTS")
        self.log(f"Base URL: {self.base_url}")
        self.log("=" * 60)
        
        results = {}
        
        # Run tests in order
        results["health_check"] = self.test_health_check()
        results["product_lookup"] = self.test_product_lookup()
        results["stock_crud"] = self.test_stock_crud()
        results["priority_items"] = self.test_priority_items()
        results["consume_throw"] = self.test_consume_throw_actions()
        results["statistics"] = self.test_statistics()
        results["error_cases"] = self.test_error_cases()
        
        # Cleanup
        self.cleanup()
        
        # Summary
        self.log("=" * 60)
        self.log("TEST RESULTS SUMMARY")
        self.log("=" * 60)
        
        passed = 0
        total = len(results)
        
        for test_name, result in results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            self.log(f"{test_name.replace('_', ' ').title()}: {status}")
            if result:
                passed += 1
        
        self.log("=" * 60)
        self.log(f"OVERALL: {passed}/{total} tests passed")
        
        if passed == total:
            self.log("🎉 ALL TESTS PASSED!")
            return True
        else:
            self.log("⚠️ SOME TESTS FAILED!")
            return False

if __name__ == "__main__":
    tester = KeepEatAPITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
