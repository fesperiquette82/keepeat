"""
Tests for restore_images_from_openfoodfacts.py script

These tests verify the core logic for image URL validation used for
recovering images from the Open Food Facts API.
"""

import sys
from pathlib import Path

import pytest

# Import the script functions
script_path = Path(__file__).parent.parent / "scripts" / "restore_images_from_openfoodfacts.py"
spec = __import__("importlib.util").util.spec_from_file_location("restore_script", script_path)
restore_script = __import__("importlib.util").util.module_from_spec(spec)
spec.loader.exec_module(restore_script)


class TestIsInvalidImageUrl:
    """
    Test image URL validation logic

    This function is the core of the image restoration script - it detects
    corrupted/invalid image URLs in MongoDB that need to be restored from
    the Open Food Facts API.
    """

    def test_none_is_invalid(self):
        """None URL should be considered invalid"""
        assert restore_script.is_invalid_image_url(None) is True

    def test_empty_string_is_invalid(self):
        """Empty string should be considered invalid"""
        assert restore_script.is_invalid_image_url("") is True

    def test_whitespace_only_is_invalid(self):
        """
        Whitespace-only strings should be considered invalid

        REGRESSION: This is the main corruption case found in production -
        all image_url fields contained whitespace strings '   ' instead
        of valid URLs or null.
        """
        assert restore_script.is_invalid_image_url("   ") is True
        assert restore_script.is_invalid_image_url("\t\n  ") is True
        assert restore_script.is_invalid_image_url("     ") is True

    def test_null_string_literal_is_invalid(self):
        """String literal 'null' should be considered invalid"""
        assert restore_script.is_invalid_image_url("null") is True

    def test_undefined_string_literal_is_invalid(self):
        """String literal 'undefined' should be considered invalid"""
        assert restore_script.is_invalid_image_url("undefined") is True

    def test_non_string_is_invalid(self):
        """Non-string values should be considered invalid"""
        assert restore_script.is_invalid_image_url(123) is True
        assert restore_script.is_invalid_image_url([]) is True
        assert restore_script.is_invalid_image_url({}) is True
        assert restore_script.is_invalid_image_url(True) is True

    def test_valid_url_is_valid(self):
        """Valid URLs should not be considered invalid"""
        assert restore_script.is_invalid_image_url("https://example.com/image.jpg") is False
        assert restore_script.is_invalid_image_url("http://example.com/image.png") is False
        assert restore_script.is_invalid_image_url("https://images.openfoodfacts.org/images/products/123.jpg") is False

    def test_url_with_surrounding_whitespace_is_valid(self):
        """URLs with surrounding whitespace should be valid (trimming applied)"""
        assert restore_script.is_invalid_image_url("  https://example.com/image.jpg  ") is False
        assert restore_script.is_invalid_image_url("\thttps://example.com/image.jpg\n") is False


class TestScriptConfiguration:
    """Test script configuration and constants"""

    def test_mongodb_uri_has_default(self):
        """MONGODB_URI should have a sensible default"""
        assert restore_script.MONGODB_URI == "mongodb://localhost:27017"

    def test_db_name_uses_env_or_default(self):
        """DB_NAME should use environment variable or default to keepeat"""
        import os
        expected = os.getenv("DB_NAME", "keepeat")
        assert restore_script.DB_NAME == expected

    def test_api_url_template_valid(self):
        """Open Food Facts API URL template should be valid"""
        assert "{barcode}" in restore_script.OPENFOODFACTS_API
        assert "openfoodfacts.org" in restore_script.OPENFOODFACTS_API

    def test_user_agent_identifies_keepeat(self):
        """User agent should identify as KeepEat app"""
        assert "KeepEat" in restore_script.USER_AGENT

    def test_stats_dict_has_expected_keys(self):
        """Stats dictionary should track all expected metrics"""
        expected_keys = {
            "total_items",
            "items_with_barcode",
            "items_needing_image",
            "images_found",
            "images_not_found",
            "images_updated",
            "errors",
        }
        assert set(restore_script.stats.keys()) == expected_keys

    def test_all_stats_start_at_zero(self):
        """All statistics should start at zero"""
        for key, value in restore_script.stats.items():
            assert value == 0, f"Stat {key} should start at 0, got {value}"
