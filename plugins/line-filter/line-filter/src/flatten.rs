use serde_json::Value;
use std::collections::HashMap;

pub fn flatten_json(obj: &Value, prefix: &str, result: &mut HashMap<String, Value>) {
    match obj {
        Value::Object(map) => {
            for (key, value) in map {
                let new_key = if prefix.is_empty() { key.clone() } else { format!("{}.{}", prefix, key) };
                flatten_json(value, &new_key, result);
            }
        }
        Value::Array(arr) => {
            for (i, value) in arr.iter().enumerate() {
                let new_key = if prefix.is_empty() {
                    format!("[{}]", i)
                } else {
                    format!("{}[{}]", prefix, i)
                };
                flatten_json(value, &new_key, result);
            }
        }
        _ => {
            if !prefix.is_empty() {
                result.insert(prefix.to_string(), obj.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn test_flatten_simple_object() {
        let input = json!({
            "name": "John",
            "age": 30
        });

        let mut result = HashMap::new();
        flatten_json(&input, "", &mut result);

        assert_eq!(result.get("name").unwrap().as_str().unwrap(), "John");
        assert_eq!(result.get("age").unwrap().as_i64().unwrap(), 30);
    }

    #[test]
    fn test_flatten_nested_object() {
        let input = json!({
            "user": {
                "name": "John",
                "address": {
                    "city": "New York",
                    "zip": "10001"
                }
            }
        });

        let mut result = HashMap::new();
        flatten_json(&input, "", &mut result);

        assert_eq!(result.get("user.name").unwrap().as_str().unwrap(), "John");
        assert_eq!(result.get("user.address.city").unwrap().as_str().unwrap(), "New York");
        assert_eq!(result.get("user.address.zip").unwrap().as_str().unwrap(), "10001");
    }

    #[test]
    fn test_flatten_array() {
        let input = json!({
            "users": [
                {"id": 1, "name": "John"},
                {"id": 2, "name": "Jane"}
            ]
        });

        let mut result = HashMap::new();
        flatten_json(&input, "", &mut result);

        assert_eq!(result.get("users[0].id").unwrap().as_i64().unwrap(), 1);
        assert_eq!(result.get("users[0].name").unwrap().as_str().unwrap(), "John");
        assert_eq!(result.get("users[1].id").unwrap().as_i64().unwrap(), 2);
        assert_eq!(result.get("users[1].name").unwrap().as_str().unwrap(), "Jane");
    }

    #[test]
    fn test_flatten_mixed_types() {
        let input = json!({
            "id": 1,
            "data": {
                "numbers": [1, 2, 3],
                "active": true,
                "details": {
                    "note": "test"
                }
            }
        });

        let mut result = HashMap::new();
        flatten_json(&input, "", &mut result);

        assert_eq!(result.get("id").unwrap().as_i64().unwrap(), 1);
        assert_eq!(result.get("data.numbers[0]").unwrap().as_i64().unwrap(), 1);
        assert_eq!(result.get("data.numbers[1]").unwrap().as_i64().unwrap(), 2);
        assert_eq!(result.get("data.numbers[2]").unwrap().as_i64().unwrap(), 3);
        assert!(result.get("data.active").unwrap().as_bool().unwrap());
        assert_eq!(result.get("data.details.note").unwrap().as_str().unwrap(), "test");
    }

    #[test]
    fn test_flatten_empty_object() {
        let input = json!({});

        let mut result = HashMap::new();
        flatten_json(&input, "", &mut result);

        assert!(result.is_empty());
    }

    #[test]
    fn test_flatten_null_values() {
        let input = json!({
            "name": null,
            "data": {
                "value": null
            }
        });

        let mut result = HashMap::new();
        flatten_json(&input, "", &mut result);

        assert!(result.get("name").unwrap().is_null());
        assert!(result.get("data.value").unwrap().is_null());
    }

    #[test]
    fn test_flatten_with_prefix() {
        let input = json!({
            "name": "John",
            "age": 30
        });

        let mut result = HashMap::new();
        flatten_json(&input, "user", &mut result);

        assert_eq!(result.get("user.name").unwrap().as_str().unwrap(), "John");
        assert_eq!(result.get("user.age").unwrap().as_i64().unwrap(), 30);
    }

    #[test]
    fn test_flatten_special_characters() {
        let input = json!({
            "user.name": "John",
            "data": {
                "key.with.dots": "value"
            }
        });

        let mut result = HashMap::new();
        flatten_json(&input, "", &mut result);

        assert_eq!(result.get("user.name").unwrap().as_str().unwrap(), "John");
        assert_eq!(result.get("data.key.with.dots").unwrap().as_str().unwrap(), "value");
    }
}
